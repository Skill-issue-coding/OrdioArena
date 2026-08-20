import os
import glob
import logging
import pandas as pd
import requests
import time
from pathlib import Path
from dotenv import load_dotenv
import sys
from seeding import clean_seeding

# === Configuration ===
# Look for the cleaned seeding files first, fallback to the raw output
INPUT_DIRS = ["intermediate/seeding_cleaned", "seeding/output_cleaned", "seeding/output"]
OUTPUT_DIR = "intermediate/stage2_wiki"
MAX_REQUESTS_PER_MIN = 20           # 1 request per 2 s, well within Wikipedia's limits
MIN_INTERVAL_SECONDS = 60.0 / MAX_REQUESTS_PER_MIN
BATCH_SIZE = 20                     # Wikipedia extracts API max titles per request (with exintro)

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env.local")
MAIL = os.getenv("MAIL", "")
if not MAIL:
    print("Error: Environment variable 'MAIL' must be set for the Wikidata User-Agent policy.")
    sys.exit(1)

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

def get_input_dir():
    for d in INPUT_DIRS:
        if os.path.exists(d) and glob.glob(os.path.join(d, "*.csv")):
            return d
    return None

def _do_batch_request(
    session: requests.Session,
    url: str,
    params: dict,
    limiter: "RateLimiter",
) -> dict:
    """Single API call with one 429-retry and proper limiter reset."""
    limiter.wait()
    resp = session.get(url, params=params, timeout=15)

    if resp.status_code in {429, 503}:
        wait_seconds = _retry_after_seconds(resp)
        log.warning(f"Rate limited (status {resp.status_code}), sleeping {wait_seconds:.0f}s")
        print(f"  Rate limited, sleeping {wait_seconds:.0f}s before retry…")
        time.sleep(wait_seconds)
        limiter._last_request_at = 0.0  # fire immediately after sleep, not after another 2 s
        limiter.wait()
        resp = session.get(url, params=params, timeout=15)

    try:
        return resp.json()
    except ValueError:
        snippet = (resp.text or "").strip().replace("\n", " ")[:200]
        log.warning(f"Invalid JSON (status {resp.status_code}). Body: {snippet}")
        return {}


def fetch_wikipedia_summaries(entities):
    """Fetch Swedish Wikipedia intro paragraphs using batched requests (up to 20 titles each).

    371 entities → ~19 API calls instead of 371, which avoids IP bans from rapid-fire requests.
    """
    entities = [e for e in entities if isinstance(e, str) and e.strip()]

    session = requests.Session()
    contact = f"mailto:{MAIL}" if MAIL else "no-contact"
    session.headers.update({"User-Agent": f"WordGameBot/1.0 ({contact})"})

    url = "https://sv.wikipedia.org/w/api.php"
    summaries: dict[str, str] = {}
    limiter = RateLimiter(MIN_INTERVAL_SECONDS)

    n_batches = (len(entities) + BATCH_SIZE - 1) // BATCH_SIZE
    print(f"Hämtar {len(entities)} sammanfattningar i {n_batches} batchar ({BATCH_SIZE}/batch)…")
    log.info(f"Stage 2: fetching {len(entities)} Wikipedia summaries in {n_batches} batches")

    for batch_num, batch_start in enumerate(range(0, len(entities), BATCH_SIZE), 1):
        batch = entities[batch_start : batch_start + BATCH_SIZE]

        params = {
            "action":     "query",
            "format":     "json",
            "titles":     "|".join(batch),
            "prop":       "extracts",
            "exintro":    True,
            "explaintext": True,
            "exlimit":    "max",   # return extracts for all titles in the batch
            "redirects":  1,
        }

        try:
            data = _do_batch_request(session, url, params, limiter)
        except Exception as exc:
            log.warning(f"Batch {batch_num} failed: {exc}")
            for entity in batch:
                summaries[entity] = ""
            continue

        query_data = data.get("query", {})

        # Build a lookup: every form of an entity name → canonical Wikipedia title.
        # The API returns both 'normalized' (space/case fixes) and 'redirects' arrays.
        title_map: dict[str, str] = {}
        for entry in query_data.get("normalized", []):
            title_map[entry["from"].lower()] = entry["to"]
        for entry in query_data.get("redirects", []):
            title_map[entry["from"].lower()] = entry["to"]

        # canonical title → extract
        title_to_extract: dict[str, str] = {
            page["title"]: page.get("extract", "").strip()
            for page in query_data.get("pages", {}).values()
            if "missing" not in page
        }

        for entity in batch:
            canonical = title_map.get(entity.lower(), entity)
            summaries[entity] = title_to_extract.get(canonical, "")

        if batch_num % 5 == 0 or batch_num == n_batches:
            done = min(batch_start + BATCH_SIZE, len(entities))
            print(f"  batch {batch_num}/{n_batches}, {done}/{len(entities)} entiteter klara")

    return summaries

def main():
    input_dir = get_input_dir()
    if not input_dir:
        print("Kunde inte hitta någon mapp med seeding-filer.")
        log.warning("Stage 2: no input dir found")
        return
        
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    csv_files = glob.glob(os.path.join(input_dir, "*.csv"))
    
    clean_seeding.process_seeding()

    print("=" * 50)
    print("STAGE 2: WIKIPEDIA CONTEXT ENRICHMENT")
    print("=" * 50)
    log.info("Stage 2: start")
    log.info(f"Input dir: {input_dir}")
    log.info(f"CSV files: {len(csv_files)}")
    
    for file in csv_files:
        filename = os.path.basename(file)
        
        # Skip if we've already processed this file (useful if the script crashes halfway)
        output_path = os.path.join(OUTPUT_DIR, filename)
        if os.path.exists(output_path):
            print(f"Hoppar över {filename} (redan bearbetad).")
            log.info(f"Stage 2: skip {filename} (already processed)")
            continue
            
        df = pd.read_csv(file)
        
        # Find the column that contains the actual entity names
        label_col = next((col for col in df.columns if col.endswith("Label")), None)
        if not label_col:
            label_col = 'name' if 'name' in df.columns else ('word' if 'word' in df.columns else None)
            
        if not label_col:
            print(f"Varning: Hittade ingen namn-kolumn i {filename}. Hoppar över.")
            log.warning(f"Stage 2: no label column in {filename}")
            continue
            
        # Extract unique entities to fetch
        unique_entities = df[label_col].dropna().unique()
        print(f"\nFil: {filename} | Hittade {len(unique_entities)} unika entiteter.")
        log.info(f"Stage 2: {filename} has {len(unique_entities)} entities")
        
        # Fetch the summaries
        summaries_dict = fetch_wikipedia_summaries(unique_entities)
        
        # Map the summaries back to the dataframe
        df['wiki_summary'] = df[label_col].map(summaries_dict)
        
        # Calculate success rate
        found_count = (df['wiki_summary'] != "").sum()
        print(f"Klar med {filename}. Hittade wiki-text för {found_count}/{len(df)} entiteter.")
        log.info(
            f"Stage 2: {filename} summaries {found_count}/{len(df)}"
        )
        
        # Save to intermediate/stage2_wiki/
        df.to_csv(output_path, index=False)
        log.info(f"Stage 2: wrote {output_path}")

if __name__ == "__main__":
    main()