import csv
import os
import random
import socket
import time
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple
from urllib.error import HTTPError, URLError
from SPARQLWrapper import JSON, SPARQLWrapper

# 1. Grab the master logger from main.py
log = logging.getLogger(__name__)

@dataclass(frozen=True)
class Query:
    name: str
    query_filepath: str
    output_filepath: str = ""

    ENDPOINT = "https://query.wikidata.org/sparql"
    MAIL = os.getenv("MAIL", "")
    REQUEST_TIMEOUT_SECONDS = int(os.getenv("WDQS_TIMEOUT_SECONDS", "45"))
    BASE_DELAY_SECONDS = float(os.getenv("WDQS_BASE_DELAY_SECONDS", "3.0"))
    MAX_RETRIES = int(os.getenv("WDQS_MAX_RETRIES", "4"))
    BACKOFF_BASE = float(os.getenv("WDQS_BACKOFF_BASE", "2.0"))
    RETRY_STATUS_CODES = {429, 500, 502, 503, 504}

    def __post_init__(self) -> None:
        if not self.output_filepath:
            object.__setattr__(self, "output_filepath", f"{self.name}.csv")
        if not self.MAIL:
            raise ValueError("Environment variable 'MAIL' must be set for the Wikidata User-Agent policy.")

    def _load_query(self) -> str:
        return Path(self.query_filepath).read_text(encoding="utf-8")

    @staticmethod
    def _sleep_with_jitter(base_seconds: float) -> None:
        time.sleep(base_seconds + random.random() * 0.5)

    def run_query(self) -> Dict[str, object]:
        query_text = self._load_query()
        for attempt in range(self.MAX_RETRIES + 1):
            sparql = SPARQLWrapper(self.ENDPOINT)
            sparql.setQuery(query_text)
            sparql.setReturnFormat(JSON)
            sparql.setTimeout(self.REQUEST_TIMEOUT_SECONDS)

            sparql.addCustomHttpHeader(
                "User-Agent",
                f"WordGameResearchBot/0.1 (mailto:{self.MAIL})",
            )

            self._sleep_with_jitter(self.BASE_DELAY_SECONDS)

            try:
                result = sparql.query()
                raw_json_str = result.response.read().decode("utf-8")
                return json.loads(raw_json_str, strict=False)

            except HTTPError as exc:
                if exc.code not in self.RETRY_STATUS_CODES or attempt >= self.MAX_RETRIES:
                    log.error(f"[{self.name}] HTTP Error {exc.code} on attempt {attempt + 1}. Aborting.")
                    raise
                
                # --- NEW: Specific 429 Rate Limit Handling ---
                if exc.code == 429:
                    # Try to get the Retry-After header from the urllib HTTPError
                    retry_after = exc.headers.get("Retry-After") if hasattr(exc, "headers") else None
                    
                    # If header exists, use it. Otherwise, default to 65 seconds (to clear the 1 min ban)
                    wait_time = int(retry_after) if (retry_after and retry_after.isdigit()) else 65
                    
                    log.warning(f"[{self.name}] HTTP 429 (Rate Limited). Sleeping for {wait_time} seconds to clear penalty...")
                    time.sleep(wait_time)
                    continue  # Skip the standard exponential backoff and go to the next attempt

                log.warning(f"[{self.name}] HTTP Error {exc.code}. Retrying... ({attempt + 1}/{self.MAX_RETRIES})")
                
            except (URLError, socket.timeout, json.JSONDecodeError) as e:
                if attempt >= self.MAX_RETRIES:
                    log.error(f"[{self.name}] Network/Decode Error on attempt {attempt + 1}. Aborting. Details: {e}")
                    raise
                log.warning(f"[{self.name}] Network/Decode Error. Retrying... ({attempt + 1}/{self.MAX_RETRIES})")

            backoff_seconds = self.BASE_DELAY_SECONDS * (self.BACKOFF_BASE ** attempt)
            self._sleep_with_jitter(backoff_seconds)

        raise RuntimeError("Failed to execute query after retries.")

    def parse_results(self, result: Dict[str, object]) -> Tuple[List[str], List[Dict[str, str]]]:
        head = result.get("head", {})
        headers = list(head.get("vars", []))
        bindings = result.get("results", {}).get("bindings", [])
        
        rows: List[Dict[str, str]] = []
        for binding in bindings:
            row: Dict[str, str] = {
                header: binding.get(header, {}).get("value", "") 
                for header in headers
            }
            rows.append(row)
            
        return headers, rows

    def run_and_save(self, output_dir: Path) -> List[Dict[str, str]]:
        raw_result = self.run_query()
        headers, rows = self.parse_results(raw_result)

        # Offload the sorting to Python to prevent Wikidata 502/500 crashes
        if "sitelinks" in headers:
            rows.sort(key=lambda x: int(x.get('sitelinks') or 0), reverse=True)
            # Keep top 500
            rows = rows[:500]

        output_path = output_dir / self.output_filepath
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with output_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)

        return rows