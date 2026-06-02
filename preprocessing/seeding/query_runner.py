import logging
from pathlib import Path
from typing import Dict, Iterable, List
from termcolor import colored
from .query import Query
import time

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent / "queries"

QUERY_SPECS = [
    ("swedish_celebrities", "swedish_celebrities.sparql"),
    ("swedish_companies", "swedish_companies.sparql"),
    ("global_brands", "global_brands.sparql"),
    ("video_games", "video_games.sparql"),
    ("swedish_tv_and_film", "swedish_tv_and_film.sparql"),
    ("swedish_music", "swedish_music.sparql"),
    ("swedish_food", "swedish_food.sparql"),             
    ("swedish_characters", "swedish_characters.sparql"),
    ("swedish_geography", "swedish_geography.sparql"),  
]

QUERIES_BY_NAME: Dict[str, Query] = {
    name: Query(name=name, query_filepath=str(BASE_DIR / filename))
    for name, filename in QUERY_SPECS
}

DEFAULT_QUERY_NAMES = ["swedish_music"]
QUERIES: List[Query] = [QUERIES_BY_NAME[name] for name in DEFAULT_QUERY_NAMES]

def get_query(name: str) -> Query:
    try:
        return QUERIES_BY_NAME[name]
    except KeyError as exc:
        available = ", ".join(sorted(QUERIES_BY_NAME))
        raise KeyError(colored("Unknown query ", "red"),f"'{name}'. Available: {available}") from exc

def run_all_and_save(queries: Iterable[Query], output_dir: Path) -> Dict[str, List[Dict[str, str]]]:
    """Runs a batch of queries and saves them, logging successes and failures."""
    per_query_rows: Dict[str, List[Dict[str, str]]] = {}
    failed_queries: List[str] = []
    
    log.info("=== Starting New Seeding Batch ===")
    
    for i, query in enumerate(queries):
        print(f"  executing {query.name}... \n", end="", flush=True)
        log.info(f"Executing query: {query.name}")
        
        try:
            rows = query.run_and_save(output_dir)
            per_query_rows[query.name] = rows
            
            print("  success \n")
            success_msg = f"Success: {query.name} ({len(rows)} rows saved)"
            log.info(success_msg)
            
            # --- NEW: Global Cooldown ---
            # Wait 10 seconds between queries to prevent triggering the 429 limits
            # Don't sleep after the very last query
            if i < len(list(queries)) - 1: 
                log.info(f"Cooling down for 65 seconds before next query...")
                time.sleep(65)
            
        except Exception as exc:
            # Terminal UI completes the line
            print("  fail, read log file")
            # File log gets the stack trace/error
            error_msg = f"FAILED: {query.name} - {str(exc)}"
            log.error(error_msg)
            failed_queries.append(query.name)
            
    log.info("--- SEEDING SUMMARY ---")
    if failed_queries:
        log.warning(f"Completed with {len(failed_queries)} failures: {', '.join(failed_queries)}")
    else:
        log.info("All queries executed successfully!")
        
    return per_query_rows