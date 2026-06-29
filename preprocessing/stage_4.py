import os
import logging
import pandas as pd
import spacy
import time
from pathlib import Path

try:
    from shared import (
        read_korp,
        load_kelly,
        load_custom_stopwords,
        ALLOWED_POS,  # e.g., {"NOUN", "VERB", "ADJ", "PROPN"}
        DEFAULT_KORP_FREQ,
        DOMAIN_VOCAB_EXPANSIONS,
        DOMAIN_VOCAB_KORP_MIN,
    )
    HAS_SHARED = True
except ImportError as e:
    HAS_SHARED = False
    print(f"Varning: Kunde inte importera från shared.py: {e}")
    exit()

def _setup_logger() -> logging.Logger:
    log_path = Path(__file__).resolve().parent / "pipeline.log"
    root = logging.getLogger()
    if not any(
        isinstance(h, logging.FileHandler) and h.baseFilename == str(log_path)
        for h in root.handlers
    ):
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handler.setLevel(logging.INFO)
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        root.addHandler(handler)
        root.setLevel(logging.INFO)
    return logging.getLogger(__name__)

log = _setup_logger()

# === Configuration ===
OUTPUT_DIR = "intermediate/stage4_general"
SPACY_MODEL = "sv_core_news_sm"

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    print("=" * 50)
    print("STAGE 4: LINGUISTIC FILTERING (spaCy + Kelly)")
    print("=" * 50)
    log.info("Stage 4: start")

    # 1. Load Korp Data
    print("Laddar Korp-frekvenser...")
    log.info("Stage 4: loading Korp")
    if HAS_SHARED:
        korp_data = read_korp() 
        
        if isinstance(korp_data, dict):
            df = pd.DataFrame(list(korp_data.items()), columns=['word', 'Totalt'])
        elif isinstance(korp_data, list):
            df = pd.DataFrame(korp_data)
        else:
            df = korp_data # Assume it's already a DataFrame
    else:
        # Fallback to reading the combined CSV directly
        df = pd.read_csv("intermediate/korp_cleaned/korp_combined_cleaned.csv")
    
    original_len = len(df)
    print(f" -> Hittade {original_len:,} ord i Korp.")
    log.info(f"Stage 4: Korp rows {original_len}")

    # 2. Filter by Baseline Frequency
    # We enforce a strict minimum frequency for general words to ensure they are well-known
    df['Totalt'] = pd.to_numeric(df['Totalt'], errors='coerce').fillna(0)
    # Keep the full word→freq map BEFORE the strict gate so domain-vocab words
    # that sit below DEFAULT_KORP_FREQ can still be rescued later (see step 6).
    full_korp_freq = dict(zip(df['word'].astype(str).str.lower(), df['Totalt']))
    df = df[df['Totalt'] >= DEFAULT_KORP_FREQ]
    print(f" -> Efter frekvenskrav (>= {DEFAULT_KORP_FREQ}): {len(df):,} ord kvar.")
    log.info(f"Stage 4: after freq filter {len(df)}")

    # 3. Load Kelly & Stopwords
    kelly_words = set()
    stopwords = set()
    if HAS_SHARED:
        kelly_words = load_kelly()
        stopwords = load_custom_stopwords()
    log.info(f"Stage 4: kelly_words={len(kelly_words)} stopwords={len(stopwords)}")
    
    # Drop custom stopwords immediately to save spaCy processing time
    if stopwords:
        df = df[~df['word'].isin(stopwords)]

    # 4. Process with spaCy (The heavy lifting)
    print(f"\nLaddar spaCy-modellen '{SPACY_MODEL}'...")
    log.info(f"Stage 4: loading spaCy model {SPACY_MODEL}")
    try:
        # Disable parser and ner for massive speed improvements
        nlp = spacy.load(SPACY_MODEL, disable=['parser', 'ner', 'senter'])
    except OSError:
        print(f"Fel: spaCy-modellen saknas. Kör: python -m spacy download {SPACY_MODEL}")
        return

    words_to_process = df['word'].astype(str).tolist()
    valid_words = []
    
    print(f"Börjar ordklasstaggning (POS) av {len(words_to_process):,} ord...")
    log.info(f"Stage 4: POS tagging {len(words_to_process)} words")
    start_time = time.time()

    # nlp.pipe is highly optimized for processing large lists of text
    for doc in nlp.pipe(words_to_process, batch_size=2048):
        token = doc[0] # Since we feed single words, there is only one token
        word_text = token.text
        pos = token.pos_
        
        # Check 1: Is it an allowed Part-Of-Speech? (Noun, Verb, Adjective)
        if pos not in ALLOWED_POS:
            continue
            
        # Check 2: spaCy's built-in stopword detection
        if token.is_stop:
            continue
            
        # Check 3: The Kelly List Synergy
        # If it's a valid POS, we keep it. BUT if spaCy is unsure, or it's a weird word, 
        # we check if its base form (lemma) exists in the official Kelly dictionary.
        lemma = token.lemma_.lower()
        is_in_kelly = lemma in kelly_words if kelly_words else False
        
        valid_words.append({
            'word': word_text,
            'lemma': lemma,
            'pos': pos,
            'in_kelly': is_in_kelly
        })

    print(f"Taggning klar på {time.time() - start_time:.1f} sekunder.")
    log.info("Stage 4: POS tagging complete")

    # 5. Merge and Finalize
    valid_df = pd.DataFrame(valid_words)
    final_df = pd.merge(df, valid_df, on='word', how='inner')

    # 6. Inject domain-vocabulary expansions (the curated semantic-field words
    #    players reach for per category, e.g. "konsert", "omsättning", "säsong").
    #    These bypass the strict DEFAULT_KORP_FREQ gate and use the much lower
    #    DOMAIN_VOCAB_KORP_MIN floor — but must still be *attested* in Korp at
    #    that floor (below it the w2v vector is too noisy to score reliably).
    existing_words = set(final_df['word'].astype(str).str.lower())
    domain_words = {
        w.lower()
        for words in DOMAIN_VOCAB_EXPANSIONS.values()
        for w in words
    }
    to_inject = [
        w for w in domain_words
        if w not in existing_words
        and full_korp_freq.get(w, 0) >= DOMAIN_VOCAB_KORP_MIN
    ]

    if to_inject:
        injected_rows = []
        for doc in nlp.pipe(to_inject, batch_size=256):
            token = doc[0]
            word_text = token.text
            lemma = token.lemma_.lower()
            injected_rows.append({
                'word': word_text,
                'Totalt': full_korp_freq.get(word_text.lower(), 0),
                'lemma': lemma,
                'pos': token.pos_,
                'in_kelly': lemma in kelly_words if kelly_words else False,
            })
        inject_df = pd.DataFrame(injected_rows).reindex(columns=final_df.columns)
        final_df = pd.concat([final_df, inject_df], ignore_index=True)
        print(f" -> Injicerade {len(injected_rows)} domänord (korp_freq >= {DOMAIN_VOCAB_KORP_MIN}).")
        log.info(f"Stage 4: injected {len(injected_rows)} domain-vocab words")
    else:
        log.info("Stage 4: no domain-vocab words to inject")

    # Sort by Korp frequency so the most common words are at the top
    final_df = final_df.sort_values(by='Totalt', ascending=False)

    out_path = os.path.join(OUTPUT_DIR, "general_words.csv")
    final_df.to_csv(out_path, index=False)
    log.info(f"Stage 4: wrote {out_path} ({len(final_df)})")

    print("\n" + "=" * 50)
    print(f"RESULTAT: Reducerade {original_len:,} -> {len(final_df):,} högkvalitativa ord.")
    print(f"Sparad till: {out_path}")
    print("=" * 50)

if __name__ == "__main__":
    main()