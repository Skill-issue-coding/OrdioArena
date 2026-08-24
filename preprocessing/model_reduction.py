"""
Experiment: measure vocabulary reduction from grouping w2v word vectors by
lemma, instead of the spaCy-only lemmatiser.

Method
------
1. Load the full Wikipedia2Vec word vocabulary (validity filter mirrors
   stage_5._is_valid_word, plus a number check, see _is_valid_word),
   lowercase and dedupe it -> the baseline. Words are dropped if they're
   in the stopword set, which is the CSV lists under preprocessing/stopwords/
   union closed-class words pulled from kelly.xml (prepositions, pronouns,
   subjunctions, particles, interjections, conjunctions, determiners,
   auxiliary verbs, via its kellyPartOfSpeech field).
2. Drop everything that is not Swedish-shaped, unless --no-decompound.
   A word is kept if it segments into SALDO members ("klimatarbete" ->
   "klimat" + "arbete", "medeltidsvapen" -> "medeltid" + s + "vapen"), which
   is what separates productive Swedish compounds from the foreign place
   names and Latin species binomials svwiki is full of. Frequency does not
   separate them: svwiki is an encyclopedia, so "aachen" (924 occurrences)
   outranks "zlatan" (562), and "aacanthocnema" (12) ties "husbyggnation"
   (12). Modern loanwords SALDO predates ("podd", "spotify", "corona") are
   rescued by Korp social-corpus frequency instead, see load_korp_rescue.
3. Stream-parse saldom.xml (~250MB, too big to DOM-load) into a
   {surface_lower: lemma_lower} map. A surface form that resolves to more
   than one distinct lemma across the file (cross-POS homographs, e.g.
   "får" = noun "får" (sheep) vs verb "få" (get) present tense) is dropped
   entirely, kept as its own untouched entry, never merged.
4. Baseline words SALDO has no opinion on at all (no LexicalEntry mentions
   them as a lemma or a word form) are lemmatised with spaCy instead, same
   fallback stage_5.py uses for its Korp expansion. Words SALDO flagged as
   ambiguous are left alone, spaCy doesn't get a second attempt at those.
5. For each surface->lemma pair (from either source) where both the surface
   and the lemma already have a vector in the baseline, drop the surface
   entry. The lemma's own (real, not synthesised) vector stands in for it.
   A pair where the lemma has no vector of its own is left unmerged.
6. Write the reduced vocab, in the same raw-float32 + vocab.json + meta.json
   layout stage_6.py uses for server/wordfiles/, plus the surface->lemma map.

Usage
-----
    python model_reduction.py                 # full run
    python model_reduction.py --no-decompound # skip the Swedish-shape filter
    python model_reduction.py --calibrate     # frequency-cutoff report, then exit
"""

import argparse
import csv
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

import numpy as np

BASE_DIR      = Path(__file__).resolve().parent
MODEL_PATH    = BASE_DIR / "model" / "svwiki-w2v-300d.bin"
SALDOM_XML    = BASE_DIR / "basic vocab" / "saldom.xml"
KELLY_XML     = BASE_DIR / "basic vocab" / "kelly.xml"
STOPWORDS_DIR = BASE_DIR / "basic vocab" / "stopwords"
KORP_DIR      = BASE_DIR / "korp"
SEEDING_DIR   = BASE_DIR / "seeding" / "output"
MAKT_DIR      = BASE_DIR / "seeding" / "maktbarometern" / "csv"
TARGETS_JSON  = BASE_DIR.parent / "server" / "wordfiles" / "targets.json"
OUT_DIR       = BASE_DIR / "model"

OUT_BIN    = OUT_DIR / "svwiki-w2v-lemmat-300d.bin"
OUT_VOCAB  = OUT_DIR / "svwiki-w2v-lemmat-300d.vocab.json"
OUT_META   = OUT_DIR / "svwiki-w2v-lemmat-300d.meta.json"
OUT_LEMMA  = OUT_DIR / "lemma_map.json"

MIN_WORD_LEN    = 3
# Minimum svwiki corpus occurrences a word needs to be kept. The long tail of
# the model vocabulary is foreign place names and Latin species binomials that
# appear a handful of times; real Swedish words (compounds included) appear far
# more often. Run with --calibrate to see the trade-off at several cutoffs.
MIN_MODEL_FREQ  = 0

_SWEDISH_RE     = re.compile(r"[a-zåäöA-ZÅÄÖ]")
_BAD_RE         = re.compile(r"[_/\\]")
# Reject words that contain any character outside the Swedish alphabet (a-z, å, ä, ö),
# digits, and hyphens. This removes Norwegian ø, Czech č/š, Turkish ş/ü, etc.
#
# Deliberately NOT re.IGNORECASE: under IGNORECASE Python case-folds Unicode, so
# [a-z] also admits characters whose uppercase lands in A-Z, letting Turkish ı
# (U+0131 -> "I", "adapazarı"), long s ſ (U+017F -> "S") and the Kelvin sign K
# (U+212A -> "K") slip through. Both cases are spelled out instead.
_NON_SWEDISH_RE = re.compile(r"[^a-zA-ZåäöÅÄÖ0-9\-]")
# Swedish words always contain a vowel. Words without one are acronyms (bbc, nfl).
_VOWELS         = set("aeiouyåäö")
# Three identical characters in a row does not occur in Swedish orthography
# (compound triple consonants are reduced: natt + tåg -> nattåg), so it marks
# noise like "aaa", "awww", "amerikkka".
_TRIPLE_RE      = re.compile(r"(.)\1\1")

# kellyPartOfSpeech values that mark closed-class function words, treated as
# stopwords in addition to the CSV lists. Content classes (noun/verb/
# adjective/adverb/numeral/proper name) are deliberately not in this set.
KELLY_STOPWORD_POS = {"prep", "pronoun", "subj", "particle", "interj", "conj", "det", "aux verb"}

# ── Swedish-shape (decompound) filter ────────────────────────────────────────
MAX_COMPOUND_PARTS = 3    # "vatten|lednings|verk"; beyond this, precision drops
MIN_PART_LEN       = 3    # shorter members let junk segment spuriously
# Swedish fogemorfem (linking morphemes) between compound members:
# "" (fabriksarbete has none between fabrik|s), "s" (medeltid|s|vapen),
# and the vowel linkers in gat|u|kök, kyrk|o|gård, flick|e|barn.
LINKING_MORPHEMES  = ("", "s", "o", "e", "u", "a")

# A word that fails the decompound test is still kept if it is this frequent in
# Korp's social corpora, which rescues modern loanwords SALDO predates.
# Calibrated against the gap between "poddar" (621) and "aachen" (262).
KORP_RESCUE_MIN_FREQ = 500
# korp-base-mix.csv is excluded from the rescue: it carries a "Svenska Wikipedia"
# column, so counting it would readmit the encyclopedic place names the
# decompound filter exists to remove.
KORP_EXCLUDED_FILES = {"korp-base-mix.csv"}

# ── Seeding allowlist ────────────────────────────────────────────────────────
# Names from the seeding pipeline are hand-curated game vocabulary: brands,
# celebrities, games, Swedish institutions. They bypass every filter, because
# the filters exist to *find* words of this kind, not to sit in judgement on
# them. Without the bypass the digit check alone eats "tv4", "hov1", "hv71",
# "tele2" and "nyheter24", and the decompound filter eats "atari", "avanza",
# "axfood", "bahnhof" and "alphabet".
#
# Only single-token names are usable here. Multi-word entries ("Alexander
# Isak", "Star Wars") are never word-vocabulary entries in the first place;
# stage_5.py resolves those through model.get_entity() on a separate path.
#
# Mirrors SCORE_LIMITS in seeding/clean_seeding.py: maktbarometern is scraped
# social-media ranking data, so the low-ranked tail is personal handles
# ("alva8764", "anisdondemina") rather than recognisable names. Platform key is
# the filename stem after the year prefix, "2025-facebook" -> "facebook".
MAKT_SCORE_LIMITS = {
    "arets-makthavare": 35,
    "facebook":         15,
    "instagram":        20,
    "tiktok":           13,
    "x":                 6,
    "youtube":          18,
}
MAKT_DEFAULT_SCORE_LIMIT = 0
# Strip emoji and punctuation the way clean_seeding.clean_text does, so
# "Joakim Lundell 🎥🎞️" reduces to a comparable form.
_SEED_CLEAN_RE = re.compile(r"[^\w\s\-\.\']")


def _string_has_numbers(text: str) -> bool:
    return any(char.isdigit() for char in text)


def _is_valid_word(text: str, stopwords: set) -> bool:
    if len(text) < MIN_WORD_LEN:
        return False
    if text.lower() in stopwords:
        return False
    if not _SWEDISH_RE.search(text):
        return False
    if _NON_SWEDISH_RE.search(text):
        return False
    if _BAD_RE.search(text):
        return False
    if text.startswith("http"):
        return False
    if _string_has_numbers(text):
        return False
    if not (set(text.lower()) & _VOWELS):
        return False
    if _TRIPLE_RE.search(text):
        return False
    return True


def _load_csv_stopwords() -> set[str]:
    stopwords: set[str] = set()
    if not STOPWORDS_DIR.exists():
        return stopwords
    for csv_path in STOPWORDS_DIR.glob("*.csv"):
        with open(csv_path, "r", encoding="utf-8") as f:
            for row in csv.reader(f):
                if row and row[0].strip():
                    stopwords.add(row[0].strip().lower())
    return stopwords


def _load_kelly_stopwords() -> set[str]:
    """Closed-class words (prepositions, pronouns, conjunctions, ...) from kelly.xml."""
    stopwords: set[str] = set()
    if not KELLY_XML.exists():
        return stopwords
    context = ET.iterparse(str(KELLY_XML), events=("end",))
    for _, elem in context:
        if elem.tag != "LexicalEntry":
            continue
        kpos_feat = elem.find("./Lemma/FormRepresentation/feat[@att='kellyPartOfSpeech']")
        kpos = kpos_feat.get("val") if kpos_feat is not None else None
        if kpos in KELLY_STOPWORD_POS:
            wf_feat = elem.find("./Lemma/FormRepresentation/feat[@att='writtenForm']")
            val = ((wf_feat.get("val") or "").strip().lower()) if wf_feat is not None else ""
            if val:
                stopwords.add(val)
        elem.clear()
    return stopwords


def _load_stopwords() -> set:
    """CSV stopword lists union closed-class words from kelly.xml, no caching."""
    stopwords = _load_csv_stopwords()
    kelly_stopwords = _load_kelly_stopwords()
    print(f"  Stoppord: {len(stopwords):,} (csv) + {len(kelly_stopwords):,} (kelly.xml)")
    stopwords |= kelly_stopwords
    return stopwords


def _load_model():
    """Load the Wikipedia2Vec model, returning (model, syn0)."""
    try:
        from wikipedia2vec import Wikipedia2Vec
    except ImportError:
        print("wikipedia2vec saknas. Kör: pip install wikipedia2vec")
        sys.exit(1)

    if not MODEL_PATH.exists():
        print(f"Fel: modellen saknas på {MODEL_PATH}")
        sys.exit(1)

    print("Laddar Wikipedia2Vec-modell…")
    model = Wikipedia2Vec.load(str(MODEL_PATH))
    syn0 = model.syn0
    if syn0 is None:
        print("Fel: model.syn0 är inte tillgänglig, uppgradera wikipedia2vec.")
        sys.exit(1)
    return model, syn0


def load_baseline_vocab(
    model,
    syn0,
    stopwords: set,
    min_freq: int = MIN_MODEL_FREQ,
    allowlist: set[str] | None = None,
) -> tuple[dict[str, np.ndarray], int]:
    """Full, lowercased, deduped w2v word vocab: {lower_text: vector}.

    Words occurring fewer than min_freq times in svwiki are dropped, see
    MIN_MODEL_FREQ. Words in allowlist skip both that and _is_valid_word.
    Returns (baseline, n_allowlisted).
    """
    allowlist = allowlist or set()

    print("Bygger baseline-vokabulär (lowercased, deduplicerad)…")
    baseline: dict[str, np.ndarray] = {}
    n_rare = 0
    n_allowed = 0
    for word_obj in model.dictionary.words():
        text = word_obj.text
        low = text.lower()
        allowed = low in allowlist
        if not allowed:
            if not _is_valid_word(text, stopwords):
                continue
            if word_obj.count < min_freq:
                n_rare += 1
                continue
        if low not in baseline:
            baseline[low] = syn0[word_obj.index].astype(np.float32)
            if allowed:
                n_allowed += 1

    if min_freq > 0:
        print(f"  Bortfiltrerade (frekvens < {min_freq}): {n_rare:,}")
    print(f"  Baseline: {len(baseline):,} ord (varav {n_allowed:,} från seeding-listan)")
    return baseline, n_allowed


def calibrate(stopwords: set, cutoffs=(0, 10, 20, 50, 100, 500)) -> None:
    """Report vocab size and dropped-word samples per frequency cutoff, then exit.

    Loads the model once and evaluates every cutoff against it, so the
    threshold can be picked from real data rather than guessed.
    """
    import random

    model, _ = _load_model()

    print("Samlar ordfrekvenser…")
    kept: list[tuple[str, int]] = []
    for word_obj in model.dictionary.words():
        if _is_valid_word(word_obj.text, stopwords):
            kept.append((word_obj.text.lower(), word_obj.count))

    # dedupe on the lowercased form, keeping the highest count per spelling
    by_word: dict[str, int] = {}
    for text, count in kept:
        if count > by_word.get(text, -1):
            by_word[text] = count

    total = len(by_word)
    print(f"\nEfter strukturfilter (utan frekvensgräns): {total:,} ord\n")
    print(f"{'cutoff':>8}  {'kvar':>9}  {'andel':>7}  exempel på bortfiltrerade")
    print("-" * 100)

    rng = random.Random(0)
    for cutoff in cutoffs:
        survivors = {w for w, c in by_word.items() if c >= cutoff}
        dropped = sorted(set(by_word) - survivors)
        sample = rng.sample(dropped, min(6, len(dropped))) if dropped else []
        pct = 100 * len(survivors) / total
        print(f"{cutoff:>8}  {len(survivors):>9,}  {pct:>6.1f}%  {', '.join(sample)}")

    # sanity check: words the game genuinely wants must survive the cutoff
    print("\nKontrollord (frekvens i svwiki):")
    probes = [
        "bil", "hus", "sol", "dator", "fotboll", "pizza", "stockholm", "sverige",
        "zlatan", "ikea", "abba", "spotify", "podd", "corona",
        "medeltidsvapen", "klimatarbete", "husbyggnation", "zenerdiod",
        "aachen", "aalborg", "aacanthocnema", "harpobittacus",
    ]
    for w in probes:
        c = by_word.get(w)
        print(f"  {w:18} {c if c is not None else 'saknas i vokabulären'}")


def parse_saldo() -> tuple[set[str], list[tuple[str, set[str]]]]:
    """Single stream pass over saldom.xml.

    Returns (all_surfaces, entries) where all_surfaces is every attested
    written form (used as the compound-member lexicon) and entries is
    [(lemma, surfaces)] per LexicalEntry (used to build the lemma map).
    One pass because the file is ~250MB.
    """
    all_surfaces: set[str] = set()
    entries: list[tuple[str, set[str]]] = []
    n_entries = 0

    print("Läser saldom.xml…")
    context = ET.iterparse(str(SALDOM_XML), events=("end",))
    for _, elem in context:
        if elem.tag != "LexicalEntry":
            continue
        n_entries += 1
        if n_entries % 20_000 == 0:
            print(f"  {n_entries:,} poster…")

        lemma_feat = elem.find("./Lemma/FormRepresentation/feat[@att='writtenForm']")
        lemma_text = (lemma_feat.get("val") if lemma_feat is not None else "") or ""
        lemma_l = lemma_text.strip().lower()

        surfaces = {lemma_l} if lemma_l else set()
        for wf_feat in elem.findall("./WordForm/feat[@att='writtenForm']"):
            val = (wf_feat.get("val") or "").strip().lower()
            if val:
                surfaces.add(val)

        all_surfaces |= surfaces
        if lemma_l:
            entries.append((lemma_l, surfaces))

        elem.clear()

    print(f"  {n_entries:,} LexicalEntry, {len(all_surfaces):,} ytformer")
    return all_surfaces, entries


def build_saldo_lemma_map(
    entries: list[tuple[str, set[str]]],
    valid_lowers: set[str],
) -> tuple[dict[str, str], set[str]]:
    """{surface: lemma} restricted to valid_lowers, ambiguous surfaces dropped.

    A surface resolving to two different lemmas across entries (cross-POS
    homographs, "bilar" = plural of "bil" and present tense of "bila") is
    removed entirely rather than merged onto an arbitrary winner.
    """
    surface_to_lemma: dict[str, str] = {}
    ambiguous: set[str] = set()

    for lemma_l, surfaces in entries:
        if lemma_l not in valid_lowers:
            continue
        for surf in surfaces:
            if surf not in valid_lowers:
                continue
            existing = surface_to_lemma.get(surf)
            if existing is None:
                surface_to_lemma[surf] = lemma_l
            elif existing != lemma_l:
                ambiguous.add(surf)

    for surf in ambiguous:
        surface_to_lemma.pop(surf, None)

    print(f"  {len(ambiguous):,} tvetydiga ytformer borttagna")
    return surface_to_lemma, ambiguous


def make_decompounder(all_surfaces: set[str]):
    """Return is_swedish_shaped(word) -> bool, via SALDO compound segmentation.

    A word passes if it is itself a SALDO form, or splits into at most
    MAX_COMPOUND_PARTS SALDO members joined by Swedish linking morphemes.
    This is what tells "klimatarbete" (klimat + arbete) apart from
    "aacanthocnema", which no segmentation reaches.
    """
    parts = {w for w in all_surfaces if len(w) >= MIN_PART_LEN and w.isalpha()}
    print(f"  Sammansättningsleder: {len(parts):,}")

    @lru_cache(maxsize=None)
    def splittable(word: str, depth: int = 1) -> bool:
        if word in parts:
            return True
        if depth >= MAX_COMPOUND_PARTS:
            return False
        for i in range(MIN_PART_LEN, len(word) - MIN_PART_LEN + 1):
            if word[:i] not in parts:
                continue
            for link in LINKING_MORPHEMES:
                rest = word[i:]
                if link:
                    if not rest.startswith(link):
                        continue
                    rest = rest[len(link):]
                if len(rest) >= MIN_PART_LEN and splittable(rest, depth + 1):
                    return True
        return False

    return lambda word: splittable(word)


def _clean_seed_name(text: str) -> str:
    """NFKC-normalise and strip emoji/punctuation, as clean_seeding.clean_text does."""
    text = unicodedata.normalize("NFKC", text)
    text = _SEED_CLEAN_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def _seed_name_variants(text: str) -> set[str]:
    """Both the raw name and the cleaned one.

    The cleaning exists to strip emoji off maktbarometern handles, but it also
    eats the punctuation that is part of an entity's actual title: "Halo:
    Combat Evolved" becomes "Halo Combat Evolved", "Heckler & Koch" becomes
    "Heckler Koch", and neither resolves through model.get_entity(). Keeping
    the raw form alongside the cleaned one lets the entity pass match either.
    """
    variants: set[str] = set()
    raw = unicodedata.normalize("NFKC", text).strip()
    if raw:
        variants.add(raw)
    cleaned = _clean_seed_name(text)
    if cleaned:
        variants.add(cleaned)
    return variants


def load_target_names() -> set[str]:
    """Target words from server/wordfiles/targets.json, original casing.

    These are the words the game actually picks from, so they are curated by
    definition and bypass every filter, exactly like the seeding names. Without
    this the stopword list quietly removes real targets: "grattis", "hejdå" and
    "herregud" are Kelly interjections, and "skola" is killed as the auxiliary
    verb ("shall"), taking the far more common noun ("school") with it.
    """
    if not TARGETS_JSON.exists():
        return set()
    try:
        targets = json.load(open(TARGETS_JSON, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()

    names = {str(t.get("word", "")).strip() for t in targets}
    names.discard("")
    print(f"  Targets: {len(names):,} namn från targets.json")
    return names


def load_seeding_names() -> set[str]:
    """Curated names from seeding/output/ and maktbarometern, original casing.

    Multi-word names are kept here: they are useless as word-vocabulary
    entries but are exactly what the entity pass needs, see
    load_entity_vectors.
    """
    names: set[str] = set()

    # seeding/output: Wikidata-derived entities, label column ends in "Label"
    if SEEDING_DIR.exists():
        for path in sorted(SEEDING_DIR.glob("*.csv")):
            with open(path, newline="", encoding="utf-8", errors="replace") as fh:
                reader = csv.DictReader(fh)
                fields = reader.fieldnames or []
                col = next((c for c in fields if c.endswith("Label")), None)
                if col is None:
                    # swedish_culture.csv has a single unlabelled word column
                    col = next((c for c in fields if c.lower() in ("word", "wordlabel", "name")), None)
                if col is None:
                    continue
                for row in reader:
                    names |= _seed_name_variants(row.get(col) or "")

    # maktbarometern: scraped rankings, score-gated per platform
    if MAKT_DIR.exists():
        for path in sorted(MAKT_DIR.glob("*.csv")):
            stem = path.stem
            platform = stem.split("-", 1)[-1] if "-" in stem else stem
            limit = MAKT_SCORE_LIMITS.get(platform, MAKT_DEFAULT_SCORE_LIMIT)
            with open(path, newline="", encoding="utf-8", errors="replace") as fh:
                for row in csv.DictReader(fh):
                    try:
                        score = int(row.get("score") or 0)
                    except ValueError:
                        continue
                    if score < limit:
                        continue
                    names |= _seed_name_variants(row.get("name") or "")

    n_multi = sum(1 for n in names if " " in n)
    print(f"  Seeding-namn: {len(names):,} ({len(names) - n_multi:,} enkelord, {n_multi:,} flerordsnamn)")
    return names


def load_entity_vectors(model, syn0, names: set[str]) -> dict[str, np.ndarray]:
    """Wikipedia2Vec *entity* vectors for curated names, keyed by display name.

    Multi-word targets ("7 Up", "Star Wars", "Alexander Isak") never appear in
    model.dictionary.words(), which only holds the word space. They live in the
    entity space and are reached through model.get_entity(), which is the same
    path stage_5.py takes to put them in server/wordfiles/vocab.json.

    Entities keep their original casing and are exempt from every word filter
    and from lemmatisation: "Star Wars" must not be lowercased, split, or
    merged onto a lemma, or the target stops resolving.
    """
    entities: dict[str, np.ndarray] = {}
    for name in sorted(names):
        try:
            obj = model.get_entity(name)
        except Exception:
            continue
        if obj is not None:
            entities[name] = syn0[obj.index].astype(np.float32)

    n_multi = sum(1 for n in entities if " " in n)
    print(f"  Entiteter med vektor: {len(entities):,} (varav {n_multi:,} flerordsnamn)")
    return entities


def load_korp_rescue(min_freq: int = KORP_RESCUE_MIN_FREQ) -> set[str]:
    """Words frequent in Korp's social corpora (blogs, forums, Twitter).

    Contemporary non-encyclopedic Swedish, which is where loanwords SALDO
    predates actually live: "spotify" 14k, "podd" 1.7k, "corona" 2.2k, while
    "aachen" manages 262 and "aacanthocnema" zero. That inversion relative to
    svwiki frequency is the whole point of using this corpus for the rescue.
    """
    rescue: set[str] = set()
    if not KORP_DIR.exists():
        print("  Korp-katalogen saknas, ingen räddningslista.")
        return rescue

    csv.field_size_limit(10**9)
    paths = sorted(p for p in KORP_DIR.glob("*.csv") if p.name not in KORP_EXCLUDED_FILES)
    totals: dict[str, int] = {}

    for path in paths:
        with open(path, newline="", encoding="utf-8", errors="replace") as fh:
            reader = csv.reader(fh)
            next(reader, None)  # header
            for row in reader:
                if len(row) < 2:
                    continue
                word = row[0].strip().lower()
                if not word:
                    continue
                try:
                    count = int(row[1])
                except ValueError:
                    continue
                totals[word] = totals.get(word, 0) + count

    rescue = {w for w, c in totals.items() if c >= min_freq}
    print(f"  Korp: {len(paths)} filer, {len(rescue):,} ord över {min_freq}")
    return rescue


def spacy_lemma_map(candidates: list[str]) -> dict[str, str]:
    """Lemmatise words SALDO had no opinion on at all, via spaCy (no sentence context)."""
    try:
        import spacy
    except ImportError:
        print("spaCy saknas. Kör: pip install spacy")
        sys.exit(1)

    try:
        nlp = spacy.load("sv_core_news_sm", disable=["parser", "ner", "senter"])
    except OSError:
        print("spaCy-modell 'sv_core_news_sm' saknas, installera den med:")
        print("  python -m spacy download sv_core_news_sm")
        sys.exit(1)

    print(f"Lemmatiserar {len(candidates):,} ord utan SALDO-post med spaCy…")
    result: dict[str, str] = {}
    batch_size = 2000
    for i in range(0, len(candidates), batch_size):
        if i % 30_000 == 0 and i > 0:
            print(f"    {i:,}/{len(candidates):,}…")
        batch = candidates[i : i + batch_size]
        docs = list(nlp.pipe(batch, batch_size=batch_size))
        for word, doc in zip(batch, docs):
            result[word] = doc[0].lemma_.lower() if doc else word

    return result


def _report_target_coverage(final_vectors: dict, lemma_map: dict[str, str]) -> None:
    """Check the reduced vocab against the targets the game actually picks from.

    A target that resolves neither directly nor through lemma_map cannot be
    used by impostor or anti_match, so this is the check that says whether the
    output is safe to put in front of the server at all.

    Four targets are knowingly missing: "gymet", "gymnasisternas",
    "lillasysters" and "mailar" have no vector of their own in the model, only
    their lemmas do ("gym", "gymnasist", "lillasyster", "maila"). stage_5.py
    would hand them the lemma's vector via its reverse-lemmatisation step; this
    script deliberately keeps only real vectors, so they drop out. That is an
    accepted trade, not a bug to fix by borrowing vectors here.
    """
    if not TARGETS_JSON.exists():
        return
    try:
        targets = json.load(open(TARGETS_JSON, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return

    direct = via_lemma = missing = 0
    missing_words: list[str] = []
    for entry in targets:
        word = entry.get("word", "")
        if not word:
            continue
        if word in final_vectors or word.lower() in final_vectors:
            direct += 1
        elif word.lower() in lemma_map:
            via_lemma += 1
        else:
            missing += 1
            missing_words.append(word)

    total = direct + via_lemma + missing
    print(f"\nTäckning mot targets.json ({total:,} mål):")
    print(f"  direkt i vokabulären : {direct:,}")
    print(f"  via lemma_map        : {via_lemma:,}")
    print(f"  SAKNAS               : {missing:,}")
    if missing_words:
        print(f"    {missing_words[:20]}")


def main() -> None:
    if not SALDOM_XML.exists():
        print(f"Fel: {SALDOM_XML} saknas")
        sys.exit(1)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--calibrate",
        action="store_true",
        help="report vocab size and dropped-word samples per frequency cutoff, then exit",
    )
    parser.add_argument(
        "--min-freq",
        type=int,
        default=MIN_MODEL_FREQ,
        help=f"minimum svwiki occurrences per word (default {MIN_MODEL_FREQ})",
    )
    parser.add_argument(
        "--no-decompound",
        action="store_true",
        help="keep words that do not segment into SALDO members (foreign names, binomials)",
    )
    args = parser.parse_args()

    stopwords = _load_stopwords()

    if args.calibrate:
        calibrate(stopwords)
        return

    all_surfaces, entries = parse_saldo()
    # curated vocabulary from both sources, exempt from every filter
    seed_names = load_seeding_names() | load_target_names()
    # only single-token names can be word-vocabulary entries; the multi-word
    # ones are handled by the entity pass further down
    seed_allowlist = {n.lower() for n in seed_names if " " not in n}

    model, syn0 = _load_model()
    baseline, n_seeded = load_baseline_vocab(
        model, syn0, stopwords, min_freq=args.min_freq, allowlist=seed_allowlist
    )

    # ── Swedish-shape filter ─────────────────────────────────────────────────
    n_before = len(baseline)
    n_decompounded = n_rescued = n_seed_kept = 0
    if not args.no_decompound:
        print("Filtrerar bort icke-svenska ord (sammansättningsanalys)…")
        is_swedish_shaped = make_decompounder(all_surfaces)
        korp_rescue = load_korp_rescue()

        kept: dict[str, np.ndarray] = {}
        for word, vec in baseline.items():
            if is_swedish_shaped(word):
                kept[word] = vec
                n_decompounded += 1
            elif word in korp_rescue:
                kept[word] = vec
                n_rescued += 1
            elif word in seed_allowlist:
                kept[word] = vec
                n_seed_kept += 1
        baseline = kept
        print(
            f"  Kvar: {len(baseline):,} av {n_before:,} "
            f"({n_decompounded:,} via SALDO-led, {n_rescued:,} räddade av Korp, "
            f"{n_seed_kept:,} via seeding-listan)"
        )

    print("Bygger lemma-karta…")
    surface_to_lemma, ambiguous = build_saldo_lemma_map(entries, set(baseline))
    n_entries = len(entries)

    # ── spaCy fallback for baseline words SALDO never mentions at all ────────
    # (words flagged ambiguous by SALDO are left alone, not retried here)
    uncovered = [w for w in baseline if w not in surface_to_lemma and w not in ambiguous]
    spacy_map = spacy_lemma_map(uncovered)

    print("Slår ihop ytformer mot sina lemman…")
    final_vectors = dict(baseline)
    lemma_map: dict[str, str] = {}
    skipped_no_lemma_vector = 0
    n_saldo_merged = 0
    n_spacy_merged = 0
    # Curated words keep their own vector rather than being folded onto a lemma.
    # A target is looked up by its exact word, so merging "gymet" into "gym"
    # would leave the target itself without an entry. The lemma_map still gains
    # the mapping for anything else that resolves through it.
    protected = seed_allowlist

    for surface_l, lemma_l in surface_to_lemma.items():
        if surface_l == lemma_l or surface_l in protected:
            continue
        if lemma_l not in baseline:
            skipped_no_lemma_vector += 1
            continue
        if surface_l in final_vectors:
            del final_vectors[surface_l]
            lemma_map[surface_l] = lemma_l
            n_saldo_merged += 1

    for surface_l, lemma_l in spacy_map.items():
        if surface_l == lemma_l or surface_l in protected:
            continue
        if lemma_l not in baseline:
            skipped_no_lemma_vector += 1
            continue
        if surface_l in final_vectors:
            del final_vectors[surface_l]
            lemma_map[surface_l] = lemma_l
            n_spacy_merged += 1

    baseline_count = len(baseline)
    word_count = len(final_vectors)

    # ── entity pass ──────────────────────────────────────────────────────────
    # Appended only now, after lemmatisation, so nothing here can be merged
    # onto a lemma or lowercased. An entity whose display name collides with an
    # existing word entry keeps the word entry; the vectors are the same point
    # in the shared space, and duplicating it would only bloat the output.
    print("\nHämtar entitetsvektorer…")
    entity_vectors = load_entity_vectors(model, syn0, seed_names)
    n_entities_added = 0
    for name, vec in entity_vectors.items():
        if name in final_vectors:
            continue
        final_vectors[name] = vec
        n_entities_added += 1

    final_count = len(final_vectors)

    print(f"\nEfter strukturfilter:                      {n_before:,} ord")
    print(f"  varav släppta förbi av seeding-listan:   {n_seeded:,}")
    if not args.no_decompound:
        print(f"  varav svensk form (SALDO-led):           {n_decompounded:,}")
        print(f"  varav räddade via Korp-frekvens:         {n_rescued:,}")
        print(f"  varav behållna via seeding-listan:       {n_seed_kept:,}")
    print(f"Baseline efter filtrering:                 {baseline_count:,} ord")
    print(f"SALDO LexicalEntry parsade:                {n_entries:,}")
    print(f"Tvetydiga ytformer (hoppade över):         {len(ambiguous):,}")
    print(f"Ord utan SALDO-post (spaCy-fallback):      {len(uncovered):,}")
    print(f"Grupper utan vektor för lemmat (hoppade):  {skipped_no_lemma_vector:,}")
    print(f"Slagit ihop via SALDO:                     {n_saldo_merged:,}")
    print(f"Slagit ihop via spaCy-fallback:             {n_spacy_merged:,}")
    print(f"Slagit ihop totalt (borttagna ytformer):   {len(lemma_map):,}")
    print(f"Ordvokabulär efter sammanslagning:         {word_count:,}")
    print(f"Tillagda entiteter:                        {n_entities_added:,}")
    print(f"Resultat: {final_count:,} poster ({100 * (1 - word_count / baseline_count):.1f}% ordreduktion)")

    _report_target_coverage(final_vectors, lemma_map)

    print("\nSkriver output…")
    words = sorted(final_vectors)
    embeddings = np.vstack([final_vectors[w] for w in words]).astype(np.float32)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    embeddings /= norms

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    embeddings.tofile(str(OUT_BIN))
    with OUT_VOCAB.open("w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)
    with OUT_META.open("w", encoding="utf-8") as f:
        json.dump({"n": len(words), "dims": int(embeddings.shape[1])}, f)
    with OUT_LEMMA.open("w", encoding="utf-8") as f:
        json.dump(lemma_map, f, ensure_ascii=False)

    print(f"  {OUT_BIN}  {embeddings.shape}")
    print(f"  {OUT_VOCAB}")
    print(f"  {OUT_META}")
    print(f"  {OUT_LEMMA}  ({len(lemma_map):,} poster)")


if __name__ == "__main__":
    main()
