"""
领星 ERP - eBay 商品数据获取脚本
基于样例.py 的签名与请求方式，调用领星 eBay 商品接口分页拉取全量商品数据。
"""

import base64
import hashlib
import json
import logging
import os
import time
from urllib.parse import urlencode, urljoin

import orjson
import requests
from Crypto.Cipher import AES

# ==================== 配置参数 ====================
APP_ID = os.getenv("LINGXING_APP_ID")
APP_SECRET = os.getenv("LINGXING_APP_SECRET")
TOKEN_URL = "https://openapi.lingxing.com/api/auth-server/oauth/access-token"
QUERY_URL = "https://openapi.lingxing.com/basicOpen/multiplatform/ebay/list"
TIME_OUT = 60
LOG_LEVEL = logging.DEBUG
PAGE_SIZE = 100
FILE_PATH = r"D:\projects\python\lingxing\json_data\ebay_products.jsonl"
RETRY_TIMES = 3
# 店铺ID(sids)，多个用逗号分隔（必填）
SIDS = os.getenv("LINGXING_EBAY_SIDS", "")
# 平台CodeS，eBay=10024
PLATFORM_CODE_S = os.getenv("LINGXING_EBAY_PLATFORM_CODE_S", '["10024"]')
# 国家ID(mids)，如 NA,MX,BR,US,CA（可选）
MIDS = os.getenv("LINGXING_EBAY_MIDS", "")
# 币种代码（可选）
CURRENCY_CODE = os.getenv("LINGXING_EBAY_CURRENCY_CODE", "")


class ConfigError(Exception):
    pass


def validate_config():
    if not APP_ID or not APP_SECRET:
        raise ConfigError(
            "缺少必要的配置信息。请设置环境变量：\n"
            "set LINGXING_APP_ID=your_app_id\n"
            "set LINGXING_APP_SECRET=your_app_secret"
        )


# Bytes
BLOCK_SIZE = 16


class LingxingClient:
    """领星 API 客户端，复用样例中的 Token / 签名逻辑。"""

    def __init__(self):
        self.access_token = None
        self.refresh_token = None
        self.token_expire_time = 0

    # ---------- Token ----------

    def get_access_token(self):
        data = {
            "appId": APP_ID,
            "appSecret": APP_SECRET,
        }
        try:
            response = requests.post(TOKEN_URL, data=data, timeout=TIME_OUT)
            result = response.json()
            if result.get("code") == "200":
                self.access_token = result["data"]["access_token"]
                self.token_expire_time = time.time() + result["data"]["expires_in"]
                self.refresh_token = result["data"]["refresh_token"]
                logging.info(f"获取Token成功，有效期至：{time.ctime(self.token_expire_time)}")
                time.sleep(0.1)
                return self.access_token
            else:
                logging.error(result)
                raise Exception("获取Token失败")
        except Exception as error:
            logging.error(f"获取Token请求异常：{str(error)}")
            raise error

    # ---------- 签名 ----------

    def generate_sign(self, query):
        canonical_querystring = self.format_params(query)
        md5_str = self.md5_encrypt(canonical_querystring).upper()
        sign_str = self.aes_encrypt(APP_ID, md5_str)
        return sign_str

    def do_pad(self, text):
        return text + (BLOCK_SIZE - len(text) % BLOCK_SIZE) * \
            chr(BLOCK_SIZE - len(text) % BLOCK_SIZE)

    def md5_encrypt(self, text: str):
        md = hashlib.md5()
        md.update(text.encode('utf-8'))
        return md.hexdigest()

    def aes_encrypt(self, key, data):
        key = key.encode('utf-8')
        data = self.do_pad(data)
        cipher = AES.new(key, AES.MODE_ECB)
        enc = cipher.encrypt(data.encode())
        encode_str = base64.b64encode(enc)
        enc_text = encode_str.decode('utf-8')
        return enc_text

    def format_params(self, request_params):
        if not request_params or not isinstance(request_params, dict):
            return ''
        canonical_strs = []
        sort_keys = sorted(request_params.keys())
        for k in sort_keys:
            v = request_params[k]
            if v == "":
                continue
            elif isinstance(v, (dict, list)):
                canonical_strs.append(f"{k}={orjson.dumps(v, option=orjson.OPT_SORT_KEYS).decode()}")
            else:
                canonical_strs.append(f"{k}={v}")
        return "&".join(canonical_strs)

    # ---------- 请求封装 ----------

    def post_request(self, url: str, body: dict | None = None) -> dict:
        """发送带签名的 POST 请求（领星大多数业务接口用 POST，签名需包含body参数）。"""
        token = self.get_access_token()
        timestamp = f'{int(time.time())}'
        base_params = {
            "app_key": APP_ID,
            "timestamp": timestamp,
            "access_token": token,
        }
        # 领星POST接口签名需要将body参数一并参与签名计算
        sign_params = { **base_params, **(body or {}) }
        sign = self.generate_sign(sign_params)
        params = { **base_params, "sign": sign }
        headers = {"Content-Type": "application/json"}
        full_url = f"{url}?{urlencode(params)}"
        logging.debug(f"POST {full_url}")
        response = requests.post(full_url, json=body, headers=headers, timeout=TIME_OUT)
        result = response.json()
        if result.get("code") != 0:
            logging.error(f"API 返回错误：{result}")
            raise Exception(f"API 错误 code={result.get('code')} msg={result.get('msg')}")
        return result


def fetch_ebay_products(client: LingxingClient) -> list[dict]:
    """
    分页拉取 eBay 商品列表，返回全部商品原始数据。

    :param client: 领星客户端实例
    :return: 商品列表
    """
    if not SIDS:
        raise Exception("缺少店铺ID配置（LINGXING_EBAY_SIDS），请在环境变量中配置")

    # 解析平台数组
    platform_code_s = None
    if PLATFORM_CODE_S.strip():
        try:
            platform_code_s = json.loads(PLATFORM_CODE_S)
        except json.JSONDecodeError:
            platform_code_s = [PLATFORM_CODE_S]

    all_items: list[dict] = []
    offset = 0
    page = 1

    while True:
        body: dict = {
            "offset": offset,
            "length": PAGE_SIZE,
            "sids": SIDS,
        }
        if platform_code_s:
            body["platformCodeS"] = platform_code_s
        if MIDS.strip():
            body["mids"] = MIDS
        if CURRENCY_CODE.strip():
            body["currencyCode"] = CURRENCY_CODE

        logging.info(f"[第{page}页] offset={offset} length={PAGE_SIZE} sids={SIDS}")

        for attempt in range(RETRY_TIMES):
            try:
                result = client.post_request(QUERY_URL, body)
                break
            except Exception as e:
                if attempt < RETRY_TIMES - 1:
                    wait = (attempt + 1) * 2
                    logging.warning(f"第{attempt+1}次请求失败，{wait}秒后重试... ({e})")
                    time.sleep(wait)
                else:
                    raise

        data = result.get("data", {})
        # 兼容多种返回格式：list / { list } / { items }
        items: list[dict] = (
            data
            if isinstance(data, list)
            else (data.get("list") or data.get("items") or [])
        )

        if not items:
            logging.info(f"[第{page}页] 无更多数据，结束。")
            break

        all_items.extend(items)
        total_fetched = len(all_items)
        logging.info(f"[第{page}页] 本页 {len(items)} 条，累计 {total_fetched} 条")

        if len(items) < PAGE_SIZE:
            logging.info("[本页不足一页，已到末尾]")
            break

        offset += PAGE_SIZE
        page += 1

        # 安全上限：最多拉取 10 万条
        if offset > 100_000:
            logging.warning("数据量超过安全上限，停止拉取")
            break

        time.sleep(0.15)

    return all_items


def save_jsonl(items: list[dict], file_path: str):
    """将数据以 JSONL 格式写入文件（每行一个 JSON 对象）。"""
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    logging.info(f"数据已保存到：{file_path}")


if __name__ == "__main__":
    logging.basicConfig(
        level=LOG_LEVEL,
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.StreamHandler(),
        ],
    )

    validate_config()

    client = LingxingClient()

    start_time = time.time()
    products = fetch_ebay_products(client)
    elapsed = time.time() - start_time

    print(f"\n{'='*50}")
    print(f"拉取完成！共 {len(products)} 条 eBay 商品数据")
    print(f"耗时：{elapsed:.1f} 秒")

    save_jsonl(products, FILE_PATH)
