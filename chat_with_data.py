import os
import psycopg2
from sentence_transformers import SentenceTransformer
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

model = SentenceTransformer("BAAI/bge-small-en-v1.5")
groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])


def retrieve(question, top_n=3):
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    question_embedding = model.encode(question).tolist()
    cur.execute(
        """
        SELECT ticket_id, summary, status, assignee, source_url
        FROM tier0_content
        ORDER BY embedding <=> %s::vector ASC
        LIMIT %s
        """,
        (question_embedding, top_n),
    )
    results = cur.fetchall()
    cur.close()
    conn.close()
    return results


def answer_question(question):
    matches = retrieve(question)

    if not matches:
        return {"answer": "No relevant tickets found.", "citations": []}

    context = "\n".join(
        f"- {m[0]}: {m[1]} (status: {m[2]}, assignee: {m[3]})" for m in matches
    )

    prompt = (
        f"Answer this question using ONLY the tickets below. Cite ticket IDs.\n\n"
        f"Tickets:\n{context}\n\n"
        f"Question: {question}"
    )

    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": prompt}],
    )

    return {
        "answer": response.choices[0].message.content,
        "citations": [{"id": m[0], "url": m[4]} for m in matches],
    }


if __name__ == "__main__":
    question = input("Ask a question: ")
    result = answer_question(question)

    print(f"\n--- Answer ---")
    print(result["answer"])
    print(f"\n--- Citations (what a developer would see as sources) ---")
    for c in result["citations"]:
        print(f"  {c['id']}: {c['url']}")
