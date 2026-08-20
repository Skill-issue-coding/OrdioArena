import os
import sys
import glob
import logging
import pandas as pd
import requests
import time
import re
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env.local")
MAIL = os.getenv("MAIL", "")
if not MAIL:
    print("Error: Environment variable 'MAIL' must be set for the Wikidata User-Agent policy.")
    sys.exit(1)

# ===Configuration ===
INPUT_DIR = "intermediate/stage2_wiki"
OUTPUT_DIR = "intermediate/stage3_attrs"

# Wikidata shares the same IP-rate-limit pool as Wikipedia.
# 8 req/min = 7.5 s between requests, conservative but fast enough (50 QIDs/batch).
MAX_REQUESTS_PER_MIN = 30
MIN_INTERVAL_SECONDS = 60.0 / MAX_REQUESTS_PER_MIN

# The specific Wikidata properties we care about for the game
TARGET_PROPERTIES = {
    "P31": "Typ",         # Instance of (e.g., video game, tech company, human)
    "P106": "Yrke",       # Occupation (e.g., actor, singer)
    "P136": "Genre",      # Genre (music, games, film)
    "P452": "Bransch",    # Industry (for companies)
    "P178": "Utvecklare", # Developer (for games)
    "P641": "Sport",      # Sport (for athletes)
}

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

class RateLimiter:
    def __init__(self, min_interval_seconds: float) -> None:
        self.min_interval_seconds = min_interval_seconds
        self._last_request_at = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_request_at
        remaining = self.min_interval_seconds - elapsed
        if remaining > 0:
            time.sleep(remaining)
        self._last_request_at = time.monotonic()

def _retry_after_seconds(resp: requests.Response) -> float:
    retry_after = resp.headers.get("Retry-After")
    if retry_after and retry_after.isdigit():
        return float(retry_after)
    return 5.0

def extract_qid(val):
    """Safely extracts a Q-ID from a URL or string."""
    val_str = str(val).strip()
    match = re.search(r"(Q\d+)$", val_str)
    return match.group(1) if match else None

def fetch_wikidata_claims(qids, session, limiter):
    """Step 1: Fetch the raw claims (P-values) for our main entities."""
    claims_data = {}
    qids = list(set(qids))
    
    for i in range(0, len(qids), 50):
        chunk = qids[i:i+50]
        url = f"https://www.wikidata.org/w/api.php?action=wbgetentities&ids={'|'.join(chunk)}&props=claims&format=json"
        
        try:
            limiter.wait()
            resp = session.get(url, timeout=10)
            
            if resp.status_code in {429, 503}:
                wait_seconds = _retry_after_seconds(resp)
                print(
                    f"  [!] Rate limited (status {resp.status_code}). "
                    f"Sleeping {wait_seconds:.1f}s before retry."
                )
                log.warning(
                    f"Rate limited during claims fetch (status {resp.status_code}), "
                    f"sleeping {wait_seconds:.1f}s"
                )
                time.sleep(wait_seconds)
                limiter.wait()
                resp = session.get(url, timeout=10)

            resp_json = resp.json()
            if 'entities' in resp_json:
                for qid, data in resp_json['entities'].items():
                    if 'claims' in data:
                        claims_data[qid] = data['claims']
        except Exception as e:
            print(f"  [!] Nätverksfel vid hämtning av claims: {e}")
            log.warning(f"Fetch error for claims chunk: {e}")
            
    return claims_data

def fetch_wikidata_labels(qids, session, limiter):
    """Step 2: Translate the raw property Q-IDs into readable Swedish words."""
    labels = {}
    qids = list(set(qids))
    
    for i in range(0, len(qids), 50):
        chunk = qids[i:i+50]
        url = f"https://www.wikidata.org/w/api.php?action=wbgetentities&ids={'|'.join(chunk)}&props=labels&languages=sv|en&format=json"
        
        try:
            limiter.wait()
            resp = session.get(url, timeout=10)
            
            if resp.status_code in {429, 503}:
                wait_seconds = _retry_after_seconds(resp)
                print(
                    f"  [!] Rate limited (status {resp.status_code}). "
                    f"Sleeping {wait_seconds:.1f}s before retry."
                )
                log.warning(
                    f"Rate limited during labels fetch (status {resp.status_code}), "
                    f"sleeping {wait_seconds:.1f}s"
                )
                time.sleep(wait_seconds)
                limiter.wait()
                resp = session.get(url, timeout=10)

            resp_json = resp.json()
            if 'entities' in resp_json:
                for qid, data in resp_json['entities'].items():
                    if 'labels' in data:
                        # Prefer Swedish, fallback to English
                        if 'sv' in data['labels']:
                            labels[qid] = data['labels']['sv']['value']
                        elif 'en' in data['labels']:
                            labels[qid] = data['labels']['en']['value']
        except Exception as e:
            print(f"  [!] Nätverksfel vid hämtning av labels: {e}")
            log.warning(f"Fetch error for labels chunk: {e}")
            
    return labels

PAGEVIEWS_API = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/sv.wikipedia/all-access/all-agents"
SV_WIKI_API   = "https://sv.wikipedia.org/w/api.php"


def resolve_sv_titles(titles: list, session: requests.Session) -> dict:
    """Map each raw entity label → its canonical sv.wikipedia article title.

    The pageviews REST API does NOT follow redirects or normalise titles, so a
    label that differs from the article title (redirect, casing, spacing) returns
    404 → 0.0 and the entity is falsely treated as obscure. Resolve titles up
    front via the MediaWiki query API (which reports `normalized` + `redirects`)
    so pageviews are fetched against the real article title.

    Returns {raw_label: canonical_title}; labels with no sv article map to
    themselves (the pageviews fetch will then legitimately return 0.0).
    """
    clean = [t.strip() for t in titles if isinstance(t, str) and t.strip()]
    resolved: dict[str, str] = {t: t for t in clean}
    if not clean:
        return resolved

    BATCH = 50  # MediaWiki query API title cap per request
    for start in range(0, len(clean), BATCH):
        batch = clean[start : start + BATCH]
        params = {
            "action":    "query",
            "format":    "json",
            "titles":    "|".join(batch),
            "redirects": 1,
        }
        try:
            time.sleep(0.05)
            resp = session.get(SV_WIKI_API, params=params, timeout=15)
            if resp.status_code != 200:
                continue
            query = resp.json().get("query", {})
        except Exception as e:
            log.warning(f"Title resolution batch failed: {e}")
            continue

        # Chain raw → normalized → redirect target to reach the canonical title.
        step: dict[str, str] = {}
        for entry in query.get("normalized", []):
            step[entry["from"]] = entry["to"]
        for entry in query.get("redirects", []):
            step[entry["from"]] = entry["to"]

        for raw in batch:
            canonical = raw
            seen = set()
            while canonical in step and canonical not in seen:
                seen.add(canonical)
                canonical = step[canonical]
            resolved[raw] = canonical

    return resolved


def fetch_sv_pageviews_avg(titles: list, session: requests.Session) -> dict:
    """Return {title: monthly_avg_views} for each title from sv.wikipedia (trailing 12 months).

    Returns 0.0 for titles with no Swedish Wikipedia article or any fetch error.
    Wikimedia Analytics API allows ~100 req/s with User-Agent set, no heavy rate limit needed.
    """
    today = datetime.utcnow()
    end_str   = today.strftime("%Y%m") + "01"
    start_str = (today - timedelta(days=365)).strftime("%Y%m") + "01"

    results: dict = {}
    for title in titles:
        if not title or not isinstance(title, str) or not title.strip():
            continue
        encoded = requests.utils.quote(title.strip().replace(" ", "_"), safe="")
        url = f"{PAGEVIEWS_API}/{encoded}/monthly/{start_str}/{end_str}"
        try:
            time.sleep(0.05)  # 20 req/s, well within Wikimedia limits
            resp = session.get(url, timeout=10)
            if resp.status_code == 404:
                results[title] = 0.0
                continue
            if resp.status_code != 200:
                results[title] = 0.0
                continue
            items = resp.json().get("items", [])
            results[title] = sum(i.get("views", 0) for i in items) / len(items) if items else 0.0
        except Exception:
            results[title] = 0.0
    return results


def enrich_with_pageviews(output_dir: str, session: requests.Session) -> None:
    """Add sv_pageviews_monthly_avg column to any stage3 CSV that is missing it."""
    csv_files = glob.glob(os.path.join(output_dir, "*.csv"))
    needs_enrichment = [p for p in csv_files
                        if "sv_pageviews_monthly_avg" not in pd.read_csv(p, nrows=0).columns]
    if not needs_enrichment:
        print("Alla stage3-filer har redan pageview-data.")
        log.info("Stage 3 pageviews: all files already enriched")
        return

    print(f"\nHämtar sv.wikipedia-sidvisningar för {len(needs_enrichment)} filer…")
    log.info(f"Stage 3 pageviews: enriching {len(needs_enrichment)} files")

    for path in needs_enrichment:
        df = pd.read_csv(path)
        label_col = next((c for c in df.columns if c.endswith("Label")), None)
        if not label_col:
            label_col = "name" if "name" in df.columns else None
        if not label_col:
            df["sv_pageviews_monthly_avg"] = 0.0
            df.to_csv(path, index=False)
            continue

        titles = df[label_col].dropna().astype(str).tolist()
        # Resolve labels → canonical article titles first so redirects/casing
        # don't cause false 0.0 pageviews (which would wrongly demote the entity).
        label_to_title = resolve_sv_titles(titles, session)
        pageviews_by_title = fetch_sv_pageviews_avg(
            list(dict.fromkeys(label_to_title.values())), session
        )
        df["sv_pageviews_monthly_avg"] = df[label_col].map(
            lambda t: pageviews_by_title.get(
                label_to_title.get(str(t).strip(), str(t).strip()), 0.0
            )
        )
        df.to_csv(path, index=False)
        found = (df["sv_pageviews_monthly_avg"] > 0).sum()
        print(f"  {os.path.basename(path)}: pageviews hittade för {found}/{len(df)} entiteter")
        log.info(f"Stage 3 pageviews: {os.path.basename(path)} enriched ({found}/{len(df)})")


def main():
    if not os.path.exists(INPUT_DIR):
        print(f"Fel: Hittar inte {INPUT_DIR}. Kör stage 2 först!")
        log.warning(f"Stage 3: input dir missing: {INPUT_DIR}")
        return
        
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    csv_files = glob.glob(os.path.join(INPUT_DIR, "*.csv"))
    
    session = requests.Session()
    contact = f"mailto:{MAIL}" if MAIL else "no-contact"
    session.headers.update({"User-Agent": f"WordGameBot/1.0 ({contact})"})
    
    # Initialize our rate limiter
    limiter = RateLimiter(MIN_INTERVAL_SECONDS)

    print("=" * 50)
    print("STAGE 3: WIKIDATA ATTRIBUTE ENRICHMENT")
    print("=" * 50)
    log.info("Stage 3: start")
    log.info(f"Input dir: {INPUT_DIR}")
    log.info(f"CSV files: {len(csv_files)}")

    for file in csv_files:
        filename = os.path.basename(file)
        output_path = os.path.join(OUTPUT_DIR, filename)
        
        if os.path.exists(output_path):
            print(f"Hoppar över {filename} (redan bearbetad).")
            log.info(f"Stage 3: skip {filename} (already processed)")
            continue
            
        df = pd.read_csv(file)
        
        # 1. Find the column containing the Wikidata URI/Q-ID (usually named 'person', 'game', 'company')
        qid_col = next(
            (col for col in df.columns
             if df[col].dropna().astype(str).str.contains("wikidata.org/entity/", na=False).any()),
            None,
        )
        
        # If no Q-ID column exists (like in Maktbarometern), just pass the file through unchanged
        if not qid_col:
            print(f"Fil: {filename} | Inga Wikidata-länkar hittades (troligen sociala medier). Passerar igenom.")
            log.info(f"Stage 3: {filename} has no QID column")
            df['wiki_attributes'] = ""
            df.to_csv(output_path, index=False)
            log.info(f"Stage 3: wrote {output_path}")
            continue
            
        print(f"\nFil: {filename} | Hämtar attribut...")
        log.info(f"Stage 3: processing {filename}")
        
        # Extract clean Q-IDs
        df['clean_qid'] = df[qid_col].apply(extract_qid)
        valid_qids = df['clean_qid'].dropna().unique().tolist()
        log.info(f"Stage 3: {filename} has {len(valid_qids)} QIDs")
        
        # 2. Fetch all claims using rate limiting
        claims_data = fetch_wikidata_claims(valid_qids, session, limiter)
        
        # 3. Harvest all the "Value Q-IDs" we need to translate
        needed_label_qids = set()
        for qid, claims in claims_data.items():
            for prop_id in TARGET_PROPERTIES.keys():
                if prop_id in claims:
                    for statement in claims[prop_id]:
                        try:
                            val_qid = statement['mainsnak']['datavalue']['value']['id']
                            needed_label_qids.add(val_qid)
                        except KeyError:
                            pass
                            
        # 4. Fetch the Swedish translations for those Q-IDs using rate limiting
        print(f" -> Översätter {len(needed_label_qids)} unika egenskaper till svenska...")
        log.info(f"Stage 3: translating {len(needed_label_qids)} property QIDs")
        property_labels = fetch_wikidata_labels(list(needed_label_qids), session, limiter)
        
        # 5. Assemble the final text strings
        attributes_list = []
        for index, row in df.iterrows():
            qid = row['clean_qid']
            if not qid or pd.isna(qid) or qid not in claims_data:
                attributes_list.append("")
                continue
                
            entity_claims = claims_data[qid]
            entity_text_parts = []
            
            for prop_id, prop_name in TARGET_PROPERTIES.items():
                if prop_id in entity_claims:
                    # Get all values for this property (e.g., a person might be both Actor and Singer)
                    vals = []
                    for statement in entity_claims[prop_id]:
                        try:
                            val_qid = statement['mainsnak']['datavalue']['value']['id']
                            if val_qid in property_labels:
                                vals.append(property_labels[val_qid])
                        except KeyError:
                            pass
                            
                    if vals:
                        # Construct "Yrke: skådespelare, sångare"
                        entity_text_parts.append(f"{prop_name}: {', '.join(vals)}.")
            
            attributes_list.append(" ".join(entity_text_parts))
            
        df['wiki_attributes'] = attributes_list
        df = df.drop(columns=['clean_qid'])
        
        found_count = sum(1 for a in attributes_list if a)
        print(f"Klar! Hittade strukturerad data för {found_count}/{len(df)} entiteter.")
        log.info(f"Stage 3: {filename} attributes {found_count}/{len(df)}")
        df.to_csv(output_path, index=False)
        log.info(f"Stage 3: wrote {output_path}")

    # Enrich all stage3 output files with Swedish Wikipedia pageview data.
    # This runs as a separate pass so existing files get the column added without
    # re-running the expensive Wikidata attribute fetch.
    print("\n" + "=" * 50)
    print("STAGE 3b: PAGEVIEW ENRICHMENT")
    print("=" * 50)
    enrich_with_pageviews(OUTPUT_DIR, session)
    print("Stage 3 komplett.")
    log.info("Stage 3: complete")


if __name__ == "__main__":
    main()