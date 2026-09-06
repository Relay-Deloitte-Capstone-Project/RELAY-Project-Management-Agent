import os
import requests
from dotenv import load_dotenv

load_dotenv()

r = requests.get(
    "https://api.groq.com/openai/v1/models",
    headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
)
for m in r.json()["data"]:
    print(m["id"])
