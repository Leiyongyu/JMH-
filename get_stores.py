"""
领星 ERP - 查询多平台店铺列表（调试版）
尝试多个可能的接口路径。
"""

import base64
import hashlib
import json
import logging
import os
import time
from urllib.parse import urlencode

import orjson
import requests
from Crypto.Cipher import AES

# ==================== 配置 ====================
APP_ID = os.getenv("LINGXING_APP_ID")
APP_SECRET = os.getenv("LINGXING_APP_SECRET")
TOKEN_URL = "https://openapi.lingxing.com/api/auth-server/oauth/access-token"
BASE = "https://openapi.lingxing.com"
TIME_OUT = 60

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")


class LingxingClient:
    def __init__(self):
        self.access_token = None
        self.token_expire_time = 0

    def get_access_token(self):
        data = {"appId": APP_ID, "appSecret": APP_SECRET}
        response = requests.post(TOKEN_URL, data=data, timeout=TIME_OUT)
        result = response.json()
        if result.get("code") == "200":
            self.access_token = result["data"]["access_token"]
            self.token_expire_time = time.time() + result["data"]["expires_in"]
            return self.access_token
        else:
            raise Exception(f"获取Token失败: {result}")

    def generate_sign(self, query):
        canonical_querystring = self.format_params(query)
        md5_str = hashlib.md5(canonical_querystring.encode('utf-8')).hexdigest().upper()
        return self.aes_encrypt(APP_ID, md5_str)

    def do_pad(self, text):
        BLOCK_SIZE = 16
        return text + (BLOCK_SIZE - len(text) % BLOCK_SIZE) * chr(BLOCK_SIZE - len(text) % BLOCK_SIZE)

    def aes_encrypt(self, key, data):
        key = key.encode('utf-8')
        data = self.do_pad(data)
        cipher = AES.new(key, AES.MODE_ECB)
        enc = cipher.encrypt(data.encode())
        return base64.b64encode(enc).decode('utf-8')

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

    def post_request(self, url: str, body: dict | None = None) -> dict:
        token = self.get_access_token()
        timestamp = f'{int(time.time())}'
        base_params = {
            "app_key": APP_ID,
            "timestamp": timestamp,
            "access_token": token,
        }
        sign_params = {**base_params, **(body or {})}
        sign = self.generate_sign(sign_params)
        params = {**base_params, "sign": sign}
        headers = {"Content-Type": "application/json"}
        full_url = f"{url}?{urlencode(params)}"
        print(f"\n>>> POST {url}")
        response = requests.post(full_url, json=body, headers=headers, timeout=TIME_OUT)
        result = response.json()
        status = response.status_code
        print(f"<<< HTTP {status} | code={result.get('code')} msg={result.get('msg')}")
        if len(json.dumps(result, ensure_ascii=False)) < 300:
            print(f"    响应: {json.dumps(result, ensure_ascii=False)}")
        else:
            print(f"    响应: {json.dumps(result, ensure_ascii=False)[:300]}...")
        return result


def main():
    if not APP_ID or not APP_SECRET:
        print("请设置环境变量 LINGXING_APP_ID 和 LINGXING_APP_SECRET")
        return

    client = LingxingClient()

    # 尝试多个可能的店铺列表路径
    urls_to_try = [
        # 已知的 eBay 接口（验证连通性）
        ("eBay商品列表", f"{BASE}/basicOpen/multiplatform/ebay/list"),
        # 店铺相关路径猜测
        ("店铺列表1",   f"{BASE}/basicOpen/multiplatform/store/list"),
        ("店铺列表2",   f"{BASE}/basicOpen/multiplatform/storeList"),
        ("店铺列表3",   f"{BASE}/basicOpen/MultiPlatform/V2/store/list"),
        ("店铺列表4",   f"{BASE}/basicOpen/multiplatform/storeInfo/list"),
        # 文档页面路径风格
        ("利润报告文档路径", f"{BASE}/basicOpen/MultiPlatform/V2/profitReportMskuRid"),
    ]

    for name, url in urls_to_try:
        try:
            # eBay 列表用带参数的 body，其他用空 body 或最小 body
            if "ebay" in url.lower():
                body = {"offset": 0, "length": 1, "platformCodeS": ["10024"]}
            elif "profit" in url.lower():
                body = {"offset": 0, "length": 1}
            else:
                body = {"offset": 0, "length": 10}

            result = client.post_request(url, body)
        except Exception as e:
            print(f"    [异常] {e}")


if __name__ == "__main__":
    main()
