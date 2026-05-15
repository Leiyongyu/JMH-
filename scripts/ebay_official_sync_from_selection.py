import base64
import json
import os
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from html import unescape
from typing import Any
from urllib.parse import urlparse

import pymysql
import requests


def _env(name: str, default: str | None = None) -> str:
    v = os.getenv(name)
    if v is None:
        return default or ""
    return str(v).strip()


def _to_text(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _to_num(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except Exception:
        return None


def _pick_ebay_image_urls(data: dict[str, Any], limit: int = 24) -> list[str]:
    urls: list[str] = []

    def add(u: Any) -> None:
        t = _to_text(u)
        if not t:
            return
        if t in urls:
            return
        urls.append(t)

    img = data.get("image")
    if isinstance(img, dict):
        add(img.get("imageUrl"))

    add_imgs = data.get("additionalImages")
    if isinstance(add_imgs, list):
        for it in add_imgs:
            if isinstance(it, dict):
                add(it.get("imageUrl"))
            if len(urls) >= limit:
                break

    return urls[:limit]


def _pick_ebay_image_url(data: dict[str, Any]) -> str | None:
    urls = _pick_ebay_image_urls(data)
    return urls[0] if urls else None


def _marketplace_id_from_url(url: str) -> str | None:
    s = (url or "").lower()
    if "ebay.de" in s:
        return "EBAY_DE"
    if "ebay.co.uk" in s:
        return "EBAY_GB"
    if "ebay.fr" in s:
        return "EBAY_FR"
    if "ebay.it" in s:
        return "EBAY_IT"
    if "ebay.es" in s:
        return "EBAY_ES"
    if "ebay.ca" in s:
        return "EBAY_CA"
    if "ebay.com.au" in s:
        return "EBAY_AU"
    if "ebay.com" in s:
        return "EBAY_US"
    return None


_RE_ITM_1 = re.compile(r"/itm/(\d{6,})(?:[/?]|$)", re.I)
_RE_ITM_2 = re.compile(r"/itm/[^?]*?/(\d{6,})(?:[/?]|$)", re.I)
_RE_ITM_3 = re.compile(r"/itm/[^?]*?-(\d{6,})(?:[/?]|$)", re.I)
_RE_ITM_4 = re.compile(r"/(\d{6,})(?:[/?]|$)", re.I)
_RE_Q_ITEM = re.compile(r"[?&]item=(\d{6,})", re.I)


def _legacy_item_id_from_url(url: str) -> str | None:
    s = (url or "").strip()
    if not s:
        return None
    for r in (_RE_ITM_1, _RE_ITM_2, _RE_ITM_3, _RE_ITM_4):
        m = r.search(s)
        if m and m.group(1):
            return m.group(1)
    m = _RE_Q_ITEM.search(s)
    if m and m.group(1):
        return m.group(1)
    return None


def _reduced_raw_json(item: dict[str, Any]) -> dict[str, Any]:
    keep = {
        "itemId",
        "legacyItemId",
        "title",
        "itemWebUrl",
        "shortDescription",
        "image",
        "additionalImages",
        "price",
        "condition",
        "conditionId",
        "brand",
        "gtin",
        "categoryPath",
        "categoryId",
        "seller",
        "localizedAspects",
        "description",
        "itemCreationDate",
    }
    out: dict[str, Any] = {}
    for k in keep:
        if k in item:
            out[k] = item.get(k)
    return out


def _normalize_cell_text(html: str) -> str:
    s = str(html or "")
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|tr|td|th)>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return unescape(s)


def _looks_like_vehicle_table(table_html: str) -> bool:
    text = _normalize_cell_text(table_html).lower()
    hits = 0
    for k in ("marke", "modell", "baujahr", "plattform", "typ", "motor", "einschränkungen", "einschrankungen"):
        if k in text:
            hits += 1
    return hits >= 4


def _parse_vehicle_table(html: str) -> list[dict[str, Any]]:
    tables = [m.group(0) for m in re.finditer(r"<table\b[\s\S]*?</table>", html or "", flags=re.I)]
    target = ""
    for t in tables:
        if _looks_like_vehicle_table(t):
            target = t
            break
    if not target:
        return []

    trs = [m.group(0) for m in re.finditer(r"<tr\b[\s\S]*?</tr>", target, flags=re.I)]
    rows: list[list[str]] = []
    for tr in trs:
        cells = [m.group(0) for m in re.finditer(r"<(td|th)\b[\s\S]*?</\1>", tr, flags=re.I)]
        rows.append([_normalize_cell_text(c) for c in cells])

    body = [r for r in rows if len(r) >= 7]
    if not body:
        return []

    head = [str(x or "").lower() for x in body[0]]
    head_looks_like = any(("marke" in x) or ("modell" in x) or ("baujahr" in x) for x in head)
    data_rows = body[1:] if head_looks_like else body

    out: list[dict[str, Any]] = []
    for r in data_rows:
        brand = str(r[0] or "").strip()
        model = str(r[1] or "").strip()
        if not brand or not model:
            continue
        out.append(
            {
                "brand": brand,
                "model": model,
                "year_range": _to_text(r[2]),
                "platform": _to_text(r[3]),
                "vehicle_type": _to_text(r[4]),
                "engine": _to_text(r[5]),
                "restriction": _to_text(r[6]),
            }
        )
    return out


def _extract_details(item: dict[str, Any], sku: str, item_id: str) -> list[dict[str, Any]]:
    aspects = item.get("localizedAspects")
    if not isinstance(aspects, list):
        return []
    out: list[dict[str, Any]] = []
    existed: set[str] = set()
    for it in aspects:
        if not isinstance(it, dict):
            continue
        name = _to_text(it.get("name")) or ""
        if not name:
            continue
        key = name.lower()
        if key in existed:
            continue
        raw_val = it.get("value")
        if raw_val is None:
            continue
        if isinstance(raw_val, list):
            value = ", ".join([str(x or "").strip() for x in raw_val if str(x or "").strip()])
        else:
            value = str(raw_val).strip()
        if not value:
            continue
        existed.add(key)
        out.append(
            {
                "sku": sku,
                "item_id": item_id,
                "aspect_name": name,
                "aspect_value": value,
                "aspect_type": _to_text(it.get("type")) or "STRING",
            }
        )
    return out


def _extract_main(item: dict[str, Any], sku: str, item_url_from_source: str, raw_mode: str) -> dict[str, Any] | None:
    legacy = _to_text(item.get("legacyItemId")) or _to_text(item.get("itemId"))
    title = _to_text(item.get("title"))
    price = item.get("price") if isinstance(item.get("price"), dict) else {}
    price_value = _to_num(price.get("value"))
    price_currency = _to_text(price.get("currency"))
    if not legacy or not title or price_value is None or not price_currency:
        return None

    seller = item.get("seller") if isinstance(item.get("seller"), dict) else {}
    if not isinstance(seller, dict):
        seller = {}

    raw_json: Any = None
    if raw_mode == "full":
        raw_json = item
    elif raw_mode == "reduced":
        raw_json = _reduced_raw_json(item)

    image_urls = _pick_ebay_image_urls(item)
    return {
        "sku": sku,
        "item_id": legacy,
        "title": title,
        "short_description": _to_text(item.get("shortDescription")),
        "price_value": price_value,
        "price_currency": price_currency,
        "condition": _to_text(item.get("condition")),
        "condition_id": _to_text(item.get("conditionId")),
        "brand": _to_text(item.get("brand")),
        "gtin": _to_text(item.get("gtin")),
        "category_path": _to_text(item.get("categoryPath")),
        "category_id": _to_text(item.get("categoryId")),
        "seller_username": _to_text(seller.get("username")),
        "seller_feedback_score": int(_to_num(seller.get("feedbackScore")) or 0) if seller.get("feedbackScore") is not None else None,
        "seller_feedback_percentage": _to_text(seller.get("feedbackPercentage")),
        "seller_account_type": _to_text(seller.get("accountType")),
        "item_web_url": _to_text(item.get("itemWebUrl")) or _to_text(item_url_from_source),
        "item_creation_date": _to_text(item.get("itemCreationDate")),
        "raw_json": json.dumps(raw_json, ensure_ascii=False) if raw_json is not None else None,
        "image_url": image_urls[0] if image_urls else None,
        "image_urls": json.dumps(image_urls, ensure_ascii=False) if image_urls else None,
    }


@dataclass
class EbayToken:
    access_token: str
    expire_at: float


class EbayAppOAuth:
    def __init__(self, env: str, client_id: str, client_secret: str, scope: str):
        self.env = env
        self.client_id = client_id
        self.client_secret = client_secret
        self.scope = scope
        self._token: EbayToken | None = None
        self._lock = threading.Lock()

    def _origin(self) -> str:
        return "https://api.sandbox.ebay.com" if self.env == "sandbox" else "https://api.ebay.com"

    def get_access_token(self) -> str:
        with self._lock:
            now = time.time()
            if self._token and (self._token.expire_at - now) > 60:
                return self._token.access_token

            url = f"{self._origin()}/identity/v1/oauth2/token"
            basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode("utf-8")).decode("utf-8")
            headers = {"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"}
            data = {"grant_type": "client_credentials", "scope": self.scope}
            resp = requests.post(url, data=data, headers=headers, timeout=20)
            resp.raise_for_status()
            payload = resp.json()
            token = _to_text(payload.get("access_token")) or ""
            expires_in = int(payload.get("expires_in") or 0)
            if not token or expires_in <= 0:
                raise RuntimeError(f"eBay OAuth 失败: {str(payload)[:300]}")
            self._token = EbayToken(access_token=token, expire_at=now + expires_in)
            return token


class RateLimiter:
    def __init__(self, rps: float):
        self.rps = float(rps)
        self._lock = threading.Lock()
        self._next = 0.0

    def acquire(self) -> None:
        if self.rps <= 0:
            return
        interval = 1.0 / self.rps
        with self._lock:
            now = time.time()
            if self._next <= now:
                self._next = now + interval
                return
            wait = self._next - now
            self._next = self._next + interval
        if wait > 0:
            time.sleep(wait)


class EbayBrowseClient:
    def __init__(self, oauth: EbayAppOAuth, env: str, limiter: RateLimiter | None, max_retries: int):
        self.oauth = oauth
        self.env = env
        self.limiter = limiter
        self.max_retries = max(0, int(max_retries))

    def _origin(self) -> str:
        return "https://api.sandbox.ebay.com" if self.env == "sandbox" else "https://api.ebay.com"

    def get_item_by_legacy_id(self, legacy_item_id: str, marketplace_id: str) -> dict[str, Any]:
        url = f"{self._origin()}/buy/browse/v1/item/get_item_by_legacy_id"
        last_err: Exception | None = None
        for attempt in range(self.max_retries + 1):
            if self.limiter:
                self.limiter.acquire()
            try:
                token = self.oauth.get_access_token()
                resp = requests.get(
                    url,
                    params={"legacy_item_id": legacy_item_id},
                    headers={
                        "Authorization": f"Bearer {token}",
                        "X-EBAY-C-MARKETPLACE-ID": marketplace_id,
                        "Accept": "application/json",
                    },
                    timeout=20,
                )
                if resp.status_code == 404:
                    raise RuntimeError(f"eBay 未找到商品 legacyItemId={legacy_item_id} marketplaceId={marketplace_id}")
                if resp.status_code == 401:
                    raise RuntimeError("eBay OAuth 失败（请检查 Client ID/Secret 与 scope）")
                if resp.status_code == 429:
                    raise RuntimeError("eBay 限流（429）")
                resp.raise_for_status()
                data = resp.json()
                if not isinstance(data, dict):
                    raise RuntimeError("eBay 返回数据格式异常")
                return data
            except Exception as e:
                last_err = e
                if attempt >= self.max_retries:
                    break
                retryable = False
                if isinstance(e, requests.exceptions.Timeout):
                    retryable = True
                if isinstance(e, requests.exceptions.ConnectionError):
                    retryable = True
                if isinstance(e, requests.exceptions.HTTPError):
                    code = getattr(getattr(e, "response", None), "status_code", None)
                    retryable = code in (429, 500, 502, 503, 504)
                msg = str(e)
                if "429" in msg or "限流" in msg:
                    retryable = True
                if not retryable:
                    break
                time.sleep(min(30.0, 1.0 * (2**attempt)))
        raise RuntimeError(str(last_err) if last_err else "eBay 请求失败")


def _db_conn() -> pymysql.connections.Connection:
    host = _env("DATABASE_HOST") or _env("DB_HOST") or "127.0.0.1"
    port = int(_env("DATABASE_PORT") or _env("DB_PORT") or "3306")
    user = _env("DATABASE_USER") or _env("DB_USER")
    password = _env("DATABASE_PASSWORD") or _env("DB_PASSWORD")
    db = _env("DATABASE_NAME") or _env("DB_NAME")
    if not user or not db:
        raise RuntimeError("缺少数据库配置：DATABASE_HOST/PORT/USER/PASSWORD/NAME（或 DB_*）")
    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=db,
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _fetch_sku_urls(conn: pymysql.connections.Connection) -> list[dict[str, str]]:
    sql = """
    SELECT DISTINCT
      s.sku AS sku,
      p.item_url AS item_url
    FROM ebay_sku_price_selections s
    INNER JOIN ebay_products p
      ON p.sku COLLATE utf8mb4_unicode_ci = s.sku COLLATE utf8mb4_unicode_ci
    WHERE s.sku IS NOT NULL
      AND TRIM(s.sku) <> ''
      AND p.item_url IS NOT NULL
      AND TRIM(p.item_url) <> ''
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    out: list[dict[str, str]] = []
    for r in rows:
        sku = str(r.get("sku") or "").strip()
        item_url = str(r.get("item_url") or "").strip()
        if sku and item_url:
            out.append({"sku": sku, "item_url": item_url})
    return out


def _has_column(cur: pymysql.cursors.Cursor, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        LIMIT 1
        """,
        (table, column),
    )
    return cur.fetchone() is not None


def _upsert_main(cur: pymysql.cursors.Cursor, rows: list[dict[str, Any]], has_image_url: bool, has_image_urls: bool) -> None:
    if not rows:
        return
    if has_image_url and has_image_urls:
        sql = """
        INSERT INTO ebay_products_main
          (sku, item_id, title, short_description, price_value, price_currency, `condition`, condition_id, brand, gtin, category_path, category_id,
           seller_username, seller_feedback_score, seller_feedback_percentage, seller_account_type, item_web_url, image_url, image_urls, item_creation_date, raw_json)
        VALUES
          (%(sku)s, %(item_id)s, %(title)s, %(short_description)s, %(price_value)s, %(price_currency)s, %(condition)s, %(condition_id)s, %(brand)s, %(gtin)s,
           %(category_path)s, %(category_id)s, %(seller_username)s, %(seller_feedback_score)s, %(seller_feedback_percentage)s, %(seller_account_type)s,
           %(item_web_url)s, %(image_url)s, CAST(%(image_urls)s AS JSON), %(item_creation_date)s, CAST(%(raw_json)s AS JSON))
        ON DUPLICATE KEY UPDATE
          sku=VALUES(sku),
          title=VALUES(title),
          short_description=VALUES(short_description),
          price_value=VALUES(price_value),
          price_currency=VALUES(price_currency),
          `condition`=VALUES(`condition`),
          condition_id=VALUES(condition_id),
          brand=VALUES(brand),
          gtin=VALUES(gtin),
          category_path=VALUES(category_path),
          category_id=VALUES(category_id),
          seller_username=VALUES(seller_username),
          seller_feedback_score=VALUES(seller_feedback_score),
          seller_feedback_percentage=VALUES(seller_feedback_percentage),
          seller_account_type=VALUES(seller_account_type),
          item_web_url=VALUES(item_web_url),
          image_url=VALUES(image_url),
          image_urls=VALUES(image_urls),
          item_creation_date=VALUES(item_creation_date),
          raw_json=VALUES(raw_json)
        """
    elif has_image_url:
        sql = """
        INSERT INTO ebay_products_main
          (sku, item_id, title, short_description, price_value, price_currency, `condition`, condition_id, brand, gtin, category_path, category_id,
           seller_username, seller_feedback_score, seller_feedback_percentage, seller_account_type, item_web_url, item_creation_date, raw_json, image_url)
        VALUES
          (%(sku)s, %(item_id)s, %(title)s, %(short_description)s, %(price_value)s, %(price_currency)s, %(condition)s, %(condition_id)s, %(brand)s, %(gtin)s,
           %(category_path)s, %(category_id)s, %(seller_username)s, %(seller_feedback_score)s, %(seller_feedback_percentage)s, %(seller_account_type)s,
           %(item_web_url)s, %(item_creation_date)s, CAST(%(raw_json)s AS JSON), %(image_url)s)
        ON DUPLICATE KEY UPDATE
          sku=VALUES(sku),
          title=VALUES(title),
          short_description=VALUES(short_description),
          price_value=VALUES(price_value),
          price_currency=VALUES(price_currency),
          `condition`=VALUES(`condition`),
          condition_id=VALUES(condition_id),
          brand=VALUES(brand),
          gtin=VALUES(gtin),
          category_path=VALUES(category_path),
          category_id=VALUES(category_id),
          seller_username=VALUES(seller_username),
          seller_feedback_score=VALUES(seller_feedback_score),
          seller_feedback_percentage=VALUES(seller_feedback_percentage),
          seller_account_type=VALUES(seller_account_type),
          item_web_url=VALUES(item_web_url),
          item_creation_date=VALUES(item_creation_date),
          raw_json=VALUES(raw_json),
          image_url=VALUES(image_url)
        """
    elif has_image_urls:
        sql = """
        INSERT INTO ebay_products_main
          (sku, item_id, title, short_description, price_value, price_currency, `condition`, condition_id, brand, gtin, category_path, category_id,
           seller_username, seller_feedback_score, seller_feedback_percentage, seller_account_type, item_web_url, image_urls, item_creation_date, raw_json)
        VALUES
          (%(sku)s, %(item_id)s, %(title)s, %(short_description)s, %(price_value)s, %(price_currency)s, %(condition)s, %(condition_id)s, %(brand)s, %(gtin)s,
           %(category_path)s, %(category_id)s, %(seller_username)s, %(seller_feedback_score)s, %(seller_feedback_percentage)s, %(seller_account_type)s,
           %(item_web_url)s, CAST(%(image_urls)s AS JSON), %(item_creation_date)s, CAST(%(raw_json)s AS JSON))
        ON DUPLICATE KEY UPDATE
          sku=VALUES(sku),
          title=VALUES(title),
          short_description=VALUES(short_description),
          price_value=VALUES(price_value),
          price_currency=VALUES(price_currency),
          `condition`=VALUES(`condition`),
          condition_id=VALUES(condition_id),
          brand=VALUES(brand),
          gtin=VALUES(gtin),
          category_path=VALUES(category_path),
          category_id=VALUES(category_id),
          seller_username=VALUES(seller_username),
          seller_feedback_score=VALUES(seller_feedback_score),
          seller_feedback_percentage=VALUES(seller_feedback_percentage),
          seller_account_type=VALUES(seller_account_type),
          item_web_url=VALUES(item_web_url),
          image_urls=VALUES(image_urls),
          item_creation_date=VALUES(item_creation_date),
          raw_json=VALUES(raw_json)
        """
    else:
        sql = """
        INSERT INTO ebay_products_main
          (sku, item_id, title, short_description, price_value, price_currency, `condition`, condition_id, brand, gtin, category_path, category_id,
           seller_username, seller_feedback_score, seller_feedback_percentage, seller_account_type, item_web_url, item_creation_date, raw_json)
        VALUES
          (%(sku)s, %(item_id)s, %(title)s, %(short_description)s, %(price_value)s, %(price_currency)s, %(condition)s, %(condition_id)s, %(brand)s, %(gtin)s,
           %(category_path)s, %(category_id)s, %(seller_username)s, %(seller_feedback_score)s, %(seller_feedback_percentage)s, %(seller_account_type)s,
           %(item_web_url)s, %(item_creation_date)s, CAST(%(raw_json)s AS JSON))
        ON DUPLICATE KEY UPDATE
          sku=VALUES(sku),
          title=VALUES(title),
          short_description=VALUES(short_description),
          price_value=VALUES(price_value),
          price_currency=VALUES(price_currency),
          `condition`=VALUES(`condition`),
          condition_id=VALUES(condition_id),
          brand=VALUES(brand),
          gtin=VALUES(gtin),
          category_path=VALUES(category_path),
          category_id=VALUES(category_id),
          seller_username=VALUES(seller_username),
          seller_feedback_score=VALUES(seller_feedback_score),
          seller_feedback_percentage=VALUES(seller_feedback_percentage),
          seller_account_type=VALUES(seller_account_type),
          item_web_url=VALUES(item_web_url),
          item_creation_date=VALUES(item_creation_date),
          raw_json=VALUES(raw_json)
        """
    cur.executemany(sql, rows)


def _truthy(v: str) -> bool:
    s = str(v or "").strip().lower()
    return s in ("1", "true", "yes", "y", "on")


def _load_recent_item_ids(cur: pymysql.cursors.Cursor, item_ids: list[str], ttl_hours: int) -> set[str]:
    if ttl_hours <= 0 or not item_ids:
        return set()
    out: set[str] = set()
    chunk_size = 500
    for i in range(0, len(item_ids), chunk_size):
        chunk = item_ids[i : i + chunk_size]
        placeholders = ",".join(["%s"] * len(chunk))
        cur.execute(
            f"""
            SELECT item_id
            FROM ebay_products_main
            WHERE item_id IN ({placeholders})
              AND last_sync_time IS NOT NULL
              AND last_sync_time >= (NOW() - INTERVAL %s HOUR)
            """,
            chunk + [ttl_hours],
        )
        rows = cur.fetchall()
        for r in rows:
            x = _to_text(r.get("item_id"))
            if x:
                out.add(x)
    return out


def _replace_details(cur: pymysql.cursors.Cursor, item_ids: list[str], rows: list[dict[str, Any]]) -> None:
    if item_ids:
        placeholders = ",".join(["%s"] * len(item_ids))
        cur.execute(f"DELETE FROM ebay_product_details WHERE item_id IN ({placeholders})", item_ids)
    if not rows:
        return
    sql = """
    INSERT INTO ebay_product_details (sku, item_id, aspect_name, aspect_value, aspect_type)
    VALUES (%(sku)s, %(item_id)s, %(aspect_name)s, %(aspect_value)s, %(aspect_type)s)
    """
    cur.executemany(sql, rows)


def _replace_vehicles(cur: pymysql.cursors.Cursor, item_ids: list[str], rows: list[dict[str, Any]]) -> None:
    if item_ids:
        placeholders = ",".join(["%s"] * len(item_ids))
        cur.execute(f"DELETE FROM ebay_product_vehicles WHERE item_id IN ({placeholders})", item_ids)
    if not rows:
        return
    sql = """
    INSERT INTO ebay_product_vehicles (sku, item_id, brand, model, year_range, platform, vehicle_type, engine, restriction)
    VALUES (%(sku)s, %(item_id)s, %(brand)s, %(model)s, %(year_range)s, %(platform)s, %(vehicle_type)s, %(engine)s, %(restriction)s)
    """
    cur.executemany(sql, rows)


def run() -> None:
    ebay_env = (_env("EBAY_ENV") or "production").lower()
    ebay_env = "sandbox" if ebay_env == "sandbox" else "production"
    client_id = _env("EBAY_CLIENT_ID")
    client_secret = _env("EBAY_CLIENT_SECRET")
    scope = _env("EBAY_OAUTH_SCOPE", "https://api.ebay.com/oauth/api_scope")
    raw_mode = (_env("EBAY_OFFICIAL_RAW_MODE", "reduced") or "reduced").lower()
    raw_mode = raw_mode if raw_mode in ("none", "reduced", "full") else "reduced"
    parse_vehicles = _truthy(_env("EBAY_PARSE_VEHICLES", "0"))
    force_sync = _truthy(_env("EBAY_FORCE_SYNC", "0"))
    ttl_hours = int(_env("EBAY_OFFICIAL_SYNC_TTL_HOURS", "24") or "24")
    concurrency = max(1, int(_env("EBAY_CONCURRENCY", "6") or "6"))
    rps = float(_env("EBAY_RPS", "3") or "3")
    max_retries = max(0, int(_env("EBAY_MAX_RETRIES", "4") or "4"))

    if not client_id or not client_secret:
        raise RuntimeError("缺少 eBay 配置：EBAY_CLIENT_ID / EBAY_CLIENT_SECRET")

    limiter = RateLimiter(rps) if rps > 0 else None
    oauth = EbayAppOAuth(env=ebay_env, client_id=client_id, client_secret=client_secret, scope=scope)
    browse = EbayBrowseClient(oauth=oauth, env=ebay_env, limiter=limiter, max_retries=max_retries)

    conn = _db_conn()
    try:
        with conn.cursor() as cur:
            has_image_url = _has_column(cur, "ebay_products_main", "image_url")
            has_image_urls = _has_column(cur, "ebay_products_main", "image_urls")

        sources = _fetch_sku_urls(conn)
        total_sources = len(sources)

        parsed: list[dict[str, str]] = []
        skipped_parse = 0
        for it in sources:
            sku = it["sku"]
            item_url = it["item_url"]
            legacy_id = _legacy_item_id_from_url(item_url)
            mp = _marketplace_id_from_url(item_url)
            if not legacy_id or not mp:
                skipped_parse += 1
                continue
            parsed.append({"sku": sku, "item_url": item_url, "legacy_id": legacy_id, "mp": mp})

        recent_skip: set[str] = set()
        if parsed and (not force_sync) and ttl_hours > 0:
            unique_item_ids = list(dict.fromkeys([x["legacy_id"] for x in parsed]))
            with conn.cursor() as cur:
                recent_skip = _load_recent_item_ids(cur, unique_item_ids, ttl_hours)

        tasks = [x for x in parsed if x["legacy_id"] not in recent_skip]
        skipped_recent = len(parsed) - len(tasks)

        print(
            json.dumps(
                {
                    "event": "start",
                    "totalSources": total_sources,
                    "toFetch": len(tasks),
                    "skippedParse": skipped_parse,
                    "skippedRecent": skipped_recent,
                },
                ensure_ascii=False,
            )
        )
        if len(tasks) == 0:
            conn.commit()
            return

        main_rows: list[dict[str, Any]] = []
        detail_rows: list[dict[str, Any]] = []
        vehicle_rows: list[dict[str, Any]] = []
        item_ids: list[str] = []

        processed = 0
        ok = 0
        skipped = skipped_parse + skipped_recent
        failed = 0

        def worker(t: dict[str, str]) -> dict[str, Any]:
            sku = t["sku"]
            item_url = t["item_url"]
            legacy_id = t["legacy_id"]
            mp = t["mp"]
            item = browse.get_item_by_legacy_id(legacy_id, mp)
            main = _extract_main(item, sku, item_url, raw_mode)
            if not main:
                return {"status": "skipped"}
            item_id = str(main["item_id"])
            details = _extract_details(item, sku, item_id)
            vehicles: list[dict[str, Any]] = []
            if parse_vehicles:
                desc = item.get("description")
                if isinstance(desc, str) and desc.strip():
                    vs = _parse_vehicle_table(desc)
                    for v in vs:
                        vehicles.append({"sku": sku, "item_id": item_id, **v})
            return {"status": "ok", "item_id": item_id, "main": main, "details": details, "vehicles": vehicles}

        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            futures = [ex.submit(worker, t) for t in tasks]
            total = len(tasks)
            for fut in as_completed(futures):
                processed += 1
                try:
                    res = fut.result()
                    if res.get("status") != "ok":
                        skipped += 1
                    else:
                        ok += 1
                        item_id = str(res["item_id"])
                        item_ids.append(item_id)
                        main_rows.append(res["main"])
                        detail_rows.extend(res["details"])
                        vehicle_rows.extend(res["vehicles"])
                except Exception:
                    failed += 1

                if processed == total or processed % 20 == 0:
                    print(json.dumps({"event": "progress", "processed": processed, "ok": ok, "skipped": skipped, "failed": failed}, ensure_ascii=False))

        item_ids = list(dict.fromkeys([x for x in item_ids if x]))
        with conn.cursor() as cur:
            _upsert_main(cur, main_rows, has_image_url, has_image_urls)
            _replace_details(cur, item_ids, detail_rows)
            if parse_vehicles:
                _replace_vehicles(cur, item_ids, vehicle_rows)
        conn.commit()
        print(
            json.dumps(
                {
                    "event": "done",
                    "totalSources": total_sources,
                    "toFetch": len(tasks),
                    "processed": processed,
                    "ok": ok,
                    "skipped": skipped,
                    "failed": failed,
                },
                ensure_ascii=False,
            )
        )
    finally:
        conn.close()


if __name__ == "__main__":
    run()
