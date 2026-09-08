# test_keys.py — save in project-memory-explore/
import os
import httpx
from dotenv import load_dotenv

load_dotenv()

GROQ_KEY = os.getenv("GROQ_API_KEY")
GEMINI_KEY = os.getenv("GEMINI_API_KEY")

print("=" * 50)
print("API KEY DIAGNOSTICS")
print("=" * 50)

# Check Groq key format
print(f"\n1. GROQ_KEY: {'✅ Valid format (gsk_...)' if GROQ_KEY and GROQ_KEY.startswith('gsk_') else '❌ INVALID — must start with gsk_'}")
print(f"   Length: {len(GROQ_KEY) if GROQ_KEY else 0} chars")
print(f"   First 10 chars: {GROQ_KEY[:10] if GROQ_KEY else 'NONE'}")

# Check Gemini key format
print(f"\n2. GEMINI_KEY: {'✅ Valid format (AIzaSy...)' if GEMINI_KEY and GEMINI_KEY.startswith('AIza') else '❌ INVALID — must start with AIzaSy'}")
print(f"   Length: {len(GEMINI_KEY) if GEMINI_KEY else 0} chars")
print(f"   First 10 chars: {GEMINI_KEY[:10] if GEMINI_KEY else 'NONE'}")

# Quick Gemini ping
if GEMINI_KEY and GEMINI_KEY.startswith("AIza"):
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={GEMINI_KEY}"
        r = httpx.get(url, timeout=10)
        if r.status_code == 200:
            models = [m["name"] for m in r.json().get("models", []) if "gemini" in m["name"]]
            print(f"\n3. Gemini API: ✅ Working. Available models: {models[:3]}")
        else:
            print(f"\n3. Gemini API: ❌ Status {r.status_code} — {r.text[:200]}")
    except Exception as e:
        print(f"\n3. Gemini API: ❌ Error: {e}")

# Quick Groq ping
if GROQ_KEY and GROQ_KEY.startswith("gsk"):
    try:
        headers = {"Authorization": f"Bearer {GROQ_KEY}"}
        r = httpx.get("https://api.groq.com/openai/v1/models", headers=headers, timeout=10)
        if r.status_code == 200:
            models = [m["id"] for m in r.json().get("data", [])]
            print(f"\n4. Groq API: ✅ Working. Available models: {models[:5]}")
        else:
            print(f"\n4. Groq API: ❌ Status {r.status_code} — {r.text[:200]}")
    except Exception as e:
        print(f"\n4. Groq API: ❌ Error: {e}")


# ───────────────────────────────────────────────
# NEW: Groq chat completions test
# ───────────────────────────────────────────────

def _call_groq(prompt: str) -> str:
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "openai/gpt-oss-120b",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.35,
        "max_tokens": 1024
    }
    resp = httpx.post(url, json=payload, headers=headers, timeout=15.0)

    # DEBUG: print the actual error before raising
    if resp.status_code != 200:
        print(f"\n    🔴 GROQ DEBUG: Status {resp.status_code}")
        print(f"    🔴 Response: {resp.text[:300]}")

    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


print("\n" + "=" * 50)
print("GROQ CHAT COMPLETIONS TEST")
print("=" * 50)

if GROQ_KEY and GROQ_KEY.startswith("gsk"):
    try:
        test_prompt = "Say hello in exactly 3 words."
        print(f"\n5. Sending test prompt: \"{test_prompt}\"")
        reply = _call_groq(test_prompt)
        print(f"\n   ✅ Groq chat response: {reply.strip()}")
    except Exception as e:
        print(f"\n   ❌ Groq chat test failed: {e}")
else:
    print("\n5. Skipping Groq chat test — no valid GROQ_API_KEY found.")