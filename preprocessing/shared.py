import csv
import logging
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional
from dotenv import load_dotenv

"""
    MENTAL NOTE:

    Move the spacy model to the GPU -> pip install cupy-cuda11x spacy[cuda]
    ```python
    import spacy
    
    def load_spacy():
        # Tell spaCy to allocate tensors on the GPU
        spacy.prefer_gpu() 
        return spacy.load(SPACY_MODEL, disable=["parser", "ner"]) # Disable unused pipes for extra speed
    ```
"""

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env.local")

# ── Configuration ─────────────────────────────────────────────────────────────
FASTTEXT_MODEL_PATH = BASE_DIR / "model" / "kubord-fasttext-afb-2010-2024-token.bin"
BASE_KORP_DIR       = BASE_DIR / "korp"
SEEDING_DIR         = BASE_DIR / "seeding"
OUTPUT_DIR          = BASE_DIR.parent / "server" / "wordfiles"
INTERMEDIATE_DIR    = BASE_DIR / "intermediate"
CLEANED_KORP_DIR    = INTERMEDIATE_DIR / "korp_cleaned"
SEEDING_CLEANED_DIR = INTERMEDIATE_DIR / "seeding_cleaned"
SPACY_MODEL         = "sv_core_news_sm"
STOPWORDS_DIR       = BASE_DIR / "stopwords"

PCA_DIMS            = 100
NEIGHBOURS_PER_SEED = 70
TOP_N_PER_SEED      = 50
MIN_WORD_LEN        = 3

DEFAULT_KORP_FREQ = 300 # Minimum Korp frequency — keeps ~50K words vs ~300K at 30
CATEGORY_KORP_FREQ = {
    "character": 5,     # Keep low for specific names
    "game": 5,          
    "media": 10,
    "celebrity": 20,
    "company": 50,
}

# NEW: Expanded POS tags for better party-game vocabulary
ALLOWED_POS = {"NOUN", "PROPN", "VERB", "ADJ"}

CATEGORY_MAPPING = {
    "swedish_celebrities":       ("celebrity",  "celebrities_vectors.csv"),
    "swedish_music":             ("celebrity",  "celebrities_vectors.csv"),
    "swedish_companies":         ("company",    "companies_vectors.csv"),
    "swedish_consumer_companies":("company",    "companies_vectors.csv"),
    "swedish_omx_companies":     ("company",    "companies_vectors.csv"),
    "global_brands":             ("company",    "companies_vectors.csv"),
    "swedish_characters":        ("character",  "characters_vectors.csv"),
    "swedish_food":              ("food",       "food_vectors.csv"),
    "swedish_geography":         ("geography",  "geography_vectors.csv"),
    "swedish_tv_and_film":       ("media",      "media_vectors.csv"),
    "video_games":               ("game",       "games_vectors.csv"),
    "swedish_culture":           ("culture",    "culture_vectors.csv"),
    "maktbarometern_cleaned":    ("celebrity",  "celebrities_vectors.csv"),
}

# Words that bypass Kelly and use a lower Korp threshold (DOMAIN_VOCAB_KORP_MIN).
# Covers the semantic fields players reach for per entity category.
DOMAIN_VOCAB_EXPANSIONS: dict[str, list[str]] = {
    "celebrity": [
        "atlet", "idrottare", "idrottsman", "mästare", "tränare",
        "rekord", "tävling", "turnering", "debut", "karriär",
        "meritlista", "lagkapten", "landslagsman", "landslagsspelare",
        "olympier", "medalist",
    ],
    "company": [
        "aktier", "aktie", "kapital", "fond", "investering",
        "portfölj", "vinst", "omsättning", "börs", "marknad",
        "varumärke", "koncern", "dotterbolag", "vd", "styrelse",
        "aktieägare", "utdelning", "tillväxt", "kvartal",
    ],
    "media": [
        "säsong", "avsnitt", "regissör", "manus", "premiär",
        "handling", "karaktär", "rollista", "remake",
        "dokumentär", "reality", "biofilm", "serietidning",
    ],
    "game": [
        "spelmekanik", "expansion", "patch", "multiplayer",
        "singleplayer", "gameplay", "esport", "speedrun",
        "uppdatering", "dlc",
    ],
}

# Minimum Korp frequency for domain expansion words (much lower than DEFAULT_KORP_FREQ).
DOMAIN_VOCAB_KORP_MIN: int = 50

# ── Logging Setup (Terminal clean, File detailed) ─────────────────────────────
file_handler = logging.FileHandler(BASE_DIR / "pipeline.log", encoding="utf-8")
file_handler.setLevel(logging.INFO)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.WARNING)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[file_handler, console_handler],
)

# ── Shared Loaders & Helpers ──────────────────────────────────────────────────
def setup_dirs():
    INTERMEDIATE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def _is_valid_label(value: str) -> bool:
    value = (value or "").strip()
    if not value:
        return False
    if value.startswith("http"):
        return False
    if re.match(r"^Q\d+$", value):
        return False
    if re.fullmatch(r"\d+(\.\d+)?", value):
        return False
    return any(ch.isalpha() for ch in value)


def _extract_label(row: Dict[str, str]) -> Optional[str]:
    preferred_keys = (
        "personLabel",
        "artistLabel",
        "companyLabel",
        "brandLabel",
        "characterLabel",
        "foodLabel",
        "placeLabel",
        "workLabel",
        "gameLabel",
        "wordLabel",
    )

    for key in preferred_keys:
        val = row.get(key, "")
        if _is_valid_label(val):
            return val.strip()

    for key, val in row.items():
        if key.lower() in {"sitelinks", "score", "rank"}:
            continue
        if _is_valid_label(val):
            return val.strip()

    return None

def load_spacy():
    import spacy
    try:
        return spacy.load(SPACY_MODEL, disable=["parser", "ner", "senter"])
    except OSError:
        logging.error(f"spaCy model '{SPACY_MODEL}' not found.")
        sys.exit(1)

def read_korp() -> List[Dict[str, str]]:
    """Loads all Korp CSV rows into a single list of dicts.

    Normalizes headers by stripping BOMs and whitespace, and skips files
    that don't have headers or can't be read. Only rows with a word
    longer than 3 characters and containing only A-Ö are included.
    """
    if not CLEANED_KORP_DIR.exists():
        print("Had to clean up the korp files")
        from korp import clean_korp
        clean_korp.main()

    combined_path = CLEANED_KORP_DIR / "korp_combined_cleaned.csv"
    if not combined_path.exists():
        logging.warning(f"Combined Korp file not found: {combined_path}")
        return []

    rows: List[Dict[str, str]] = []
    try:
        with combined_path.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            headers = [h.lstrip("\ufeff").strip() for h in reader.fieldnames or []]
            if not headers:
                return []
            f.seek(0)
            reader = csv.DictReader(f, fieldnames=headers)
            next(reader, None)
            for row in reader:
                rows.append(row)
    except Exception:
        return []

    return rows

def load_kelly() -> set:
    """Parses kelly.xml to build a strict Swedish dictionary lookup, with caching."""
    cache_path = INTERMEDIATE_DIR / "kelly_cache.pkl"
    if cache_path.exists():
        import pickle
        with open(cache_path, "rb") as f:
            return pickle.load(f)

    import xml.etree.ElementTree as ET
    import logging
    
    # Assumes kelly.xml is in the same directory as shared.py
    kelly_path = BASE_DIR / "kelly.xml"
    words = set()
    
    if not kelly_path.exists():
        logging.warning(f"kelly.xml not found at {kelly_path}! Strict filtering will be disabled.")
        return words

    try:
        tree = ET.parse(kelly_path)
        # Extract the 'val' attribute from every <feat att="writtenForm" val="..."/> tag
        for feat in tree.findall(".//feat[@att='writtenForm']"):
            val = feat.attrib.get("val")
            if val:
                words.add(val.lower())
                
        if words:
            INTERMEDIATE_DIR.mkdir(parents=True, exist_ok=True)
            import pickle
            with open(cache_path, "wb") as f:
                pickle.dump(words, f)
                
    except Exception as e:
        logging.error(f"Failed to parse kelly.xml: {e}")

    return words

def load_custom_stopwords() -> set:
    """Dynamically loads and combines all stopword CSVs from the stopwords directory."""
    cache_path = INTERMEDIATE_DIR / "stopwords_cache.pkl"
    
    if cache_path.exists():
        import pickle
        with open(cache_path, "rb") as f:
            return pickle.load(f)

    import logging
    stopwords = set()
    
    if not STOPWORDS_DIR.exists():
        logging.warning(f"Stopwords directory not found at {STOPWORDS_DIR}! Custom stopwords disabled.")
        return stopwords

    # Find all CSV files in the folder
    for csv_path in STOPWORDS_DIR.glob("*.csv"):
        with open(csv_path, "r", encoding="utf-8") as f:
            # Assuming the CSVs are a simple list of words, 1 per line/row
            reader = csv.reader(f)
            for row in reader:
                if row and row[0].strip():
                    stopwords.add(row[0].strip().lower())
                    
    if stopwords:
        INTERMEDIATE_DIR.mkdir(parents=True, exist_ok=True)
        import pickle
        with open(cache_path, "wb") as f:
            pickle.dump(stopwords, f)
            
    return stopwords

def load_seeding() -> List[Dict[str, str]]:
    """Loads cleaned seeding CSV rows into a single list of dicts."""
    if not SEEDING_CLEANED_DIR.exists():
        print("Had to clean up the seeding files")
        from seeding import clean_seeding
        clean_seeding.process_seeding()

    rows: List[Dict[str, str]] = []
    if not SEEDING_CLEANED_DIR.exists():
        logging.warning(f"Cleaned seeding dir not found: {SEEDING_CLEANED_DIR}")
        return rows

    for csv_path in sorted(SEEDING_CLEANED_DIR.glob("*.csv")):
        try:
            with csv_path.open(encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                headers = [h.lstrip("\ufeff").strip() for h in reader.fieldnames or []]
                if not headers:
                    continue
                f.seek(0)
                reader = csv.DictReader(f, fieldnames=headers)
                next(reader, None)
                source_name = csv_path.stem
                for row in reader:
                    row["_source"] = source_name
                    rows.append(row)
        except Exception:
            continue

    return rows
