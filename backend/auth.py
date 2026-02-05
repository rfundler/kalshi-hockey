import base64
import time
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


class KalshiAuth:
    def __init__(self, api_key: str, private_key_path: str = "", private_key_content: str = ""):
        self.api_key = api_key
        self.private_key = self._load_private_key(private_key_path, private_key_content)

    def _load_private_key(self, path: str, content: str):
        if content:
            # Key passed directly (e.g., from environment variable)
            # Handle escaped newlines from env vars
            key_str = content.replace("\\n", "\n")
            key_data = key_str.encode()
        elif path:
            # Key from file path
            key_data = Path(path).read_bytes()
        else:
            raise ValueError("Either private_key_path or private_key_content must be provided")

        return serialization.load_pem_private_key(key_data, password=None)

    def get_auth_headers(self, method: str, path: str) -> dict:
        timestamp = str(int(time.time() * 1000))
        message = f"{timestamp}{method}{path}"

        signature = self.private_key.sign(
            message.encode(),
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )

        signature_b64 = base64.b64encode(signature).decode()

        return {
            "KALSHI-ACCESS-KEY": self.api_key,
            "KALSHI-ACCESS-SIGNATURE": signature_b64,
            "KALSHI-ACCESS-TIMESTAMP": timestamp,
            "Content-Type": "application/json"
        }
