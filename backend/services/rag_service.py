"""
backend/services/rag_service.py
────────────────────────────────
RAG & Embedding service using ChromaDB (ephemeral, in-memory).

Stores two categories of documents per session:
  - Raw text chunks from resume / job description (type: "resume" / "job_description")
  - Structured feature documents extracted by Gemini (type: "resume_feature" / "answer_insight")

The feature documents give the question generator rich, concise signal without
having to parse full raw text on every turn.
"""

from typing import List, Dict, Any, Optional
import chromadb
from backend.utils import logger, get_gemini_api_key


class RAGService:
    """RAG & Embedding service for indexing and retrieving resume and job description chunks using ChromaDB."""

    def __init__(self):
        # EphemeralClient is completely in-memory, leaving 0 files on disk
        self.chroma_client = chromadb.EphemeralClient()

    # ─── Embedding ─────────────────────────────────────────────────────────────

    def _call_gemini_embedding(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts using Gemini's text-embedding-004 model."""
        api_key = get_gemini_api_key("resume")
        if not api_key:
            logger.warning("No Gemini API key found for generating embeddings. Returning mock embeddings.")
            return [[0.0] * 768 for _ in texts]

        # Try google.genai first (new SDK)
        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            embeddings = []
            for text in texts:
                response = client.models.embed_content(
                    model='text-embedding-004',
                    content=text,
                )
                if response and response.embeddings:
                    embeddings.append(list(response.embeddings[0].values))
                elif response and hasattr(response, 'embedding'):
                    embeddings.append(list(response.embedding))
            if len(embeddings) == len(texts):
                return embeddings
        except Exception as e:
            logger.debug(f"google.genai embedding generation failed: {e}")

        # Fallback to legacy google.generativeai
        try:
            import google.generativeai as legacy_genai
            legacy_genai.configure(api_key=api_key)
            embeddings = []
            for text in texts:
                response = legacy_genai.embed_content(
                    model="models/text-embedding-004",
                    content=text,
                    task_type="retrieval_document",
                )
                if response and 'embedding' in response:
                    embeddings.append(response['embedding'])
            if len(embeddings) == len(texts):
                return embeddings
        except Exception as e:
            logger.error(f"Legacy Gemini embedding generation failed: {e}")

        # Ultimate fallback — zero vectors (RAG still works, just less precise)
        logger.warning("All embedding APIs failed — using zero vectors. RAG retrieval will be random.")
        return [[0.0] * 768 for _ in texts]

    # ─── Core CRUD ─────────────────────────────────────────────────────────────

    def _get_or_create_collection(self, session_id: str):
        """Get or create a ChromaDB collection for a session."""
        collection_name = f"session_{session_id}".replace("-", "_")
        return self.chroma_client.get_or_create_collection(name=collection_name)

    def add_documents(
        self,
        session_id: str,
        texts: List[str],
        metadatas: Optional[List[Dict[str, Any]]] = None,
        id_prefix: str = "chunk",
    ) -> bool:
        """Add text chunks into ephemeral ChromaDB session collection."""
        if not texts:
            return False

        try:
            collection = self._get_or_create_collection(session_id)
            embeddings = self._call_gemini_embedding(texts)
            metadatas = metadatas or [{} for _ in texts]

            # Use current count as offset to avoid ID collisions across multiple add() calls
            try:
                existing_count = collection.count()
            except Exception:
                existing_count = 0

            ids = [f"{id_prefix}_{session_id}_{existing_count + i}" for i in range(len(texts))]

            collection.add(
                ids=ids,
                documents=texts,
                embeddings=embeddings,
                metadatas=metadatas,
            )
            logger.info(f"Indexed {len(texts)} docs (prefix={id_prefix}) in ChromaDB for session {session_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to add documents to ChromaDB: {e}")
            return False

    def add_feature_document(
        self,
        session_id: str,
        feature_text: str,
        doc_type: str,
        extra_meta: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        Add a single structured feature document (resume feature or answer insight).

        Args:
            session_id:   Session identifier.
            feature_text: A human-readable string summarising the extracted features.
                          Should be concise (<600 chars) for best embedding quality.
            doc_type:     'resume_feature' | 'answer_insight' | 'jd_feature'
            extra_meta:   Optional extra fields merged into ChromaDB metadata.
        """
        meta = {"type": doc_type}
        if extra_meta:
            meta.update(extra_meta)
        return self.add_documents(
            session_id=session_id,
            texts=[feature_text],
            metadatas=[meta],
            id_prefix=f"feat_{doc_type}",
        )

    # ─── Retrieval ─────────────────────────────────────────────────────────────

    def query_context(self, session_id: str, query: str, top_k: int = 5) -> List[str]:
        """Retrieve most semantically relevant chunks for a given query from ChromaDB."""
        try:
            collection_name = f"session_{session_id}".replace("-", "_")
            try:
                collection = self.chroma_client.get_collection(name=collection_name)
            except Exception:
                logger.warning(f"ChromaDB collection for session {session_id} not found.")
                return []

            # Can't retrieve more than what's stored
            try:
                n_results = min(top_k, collection.count())
            except Exception:
                n_results = top_k

            if n_results == 0:
                return []

            query_embeddings = self._call_gemini_embedding([query])

            results = collection.query(
                query_embeddings=query_embeddings,
                n_results=n_results,
            )

            if results and 'documents' in results and results['documents']:
                flat_docs = [doc for sublist in results['documents'] for doc in sublist]
                return flat_docs
            return []
        except Exception as e:
            logger.error(f"Failed to query ChromaDB context: {e}")
            return []

    def query_by_type(
        self,
        session_id: str,
        query: str,
        doc_types: List[str],
        top_k: int = 4,
    ) -> List[str]:
        """
        Retrieve chunks filtered by document type metadata.
        Falls back to unfiltered query if filtering fails.
        """
        try:
            collection_name = f"session_{session_id}".replace("-", "_")
            try:
                collection = self.chroma_client.get_collection(name=collection_name)
            except Exception:
                return []

            try:
                n_results = min(top_k, collection.count())
            except Exception:
                n_results = top_k

            if n_results == 0:
                return []

            query_embeddings = self._call_gemini_embedding([query])

            # Build a type filter using ChromaDB's $in operator
            where_filter = {"type": {"$in": doc_types}} if len(doc_types) > 1 else {"type": doc_types[0]}

            results = collection.query(
                query_embeddings=query_embeddings,
                n_results=n_results,
                where=where_filter,
            )

            if results and 'documents' in results and results['documents']:
                return [doc for sublist in results['documents'] for doc in sublist]
            return []
        except Exception as e:
            logger.debug(f"Filtered ChromaDB query failed (falling back to unfiltered): {e}")
            return self.query_context(session_id, query, top_k)

    def get_session_memory(self, session_id: str) -> Dict[str, List[str]]:
        """
        Return all stored feature documents grouped by type.
        Useful for building rich context summaries.
        """
        try:
            collection_name = f"session_{session_id}".replace("-", "_")
            try:
                collection = self.chroma_client.get_collection(name=collection_name)
            except Exception:
                return {}

            results = collection.get(include=["documents", "metadatas"])
            memory: Dict[str, List[str]] = {}

            if results and results.get("documents"):
                for doc, meta in zip(results["documents"], results.get("metadatas", [{}] * len(results["documents"]))):
                    t = (meta or {}).get("type", "unknown")
                    memory.setdefault(t, []).append(doc)

            return memory
        except Exception as e:
            logger.error(f"Failed to get session memory: {e}")
            return {}

    # ─── Cleanup ───────────────────────────────────────────────────────────────

    def delete_session_collection(self, session_id: str) -> bool:
        """Explicitly delete a session collection to enforce zero persistence constraints."""
        try:
            collection_name = f"session_{session_id}".replace("-", "_")
            self.chroma_client.delete_collection(name=collection_name)
            logger.info(f"Successfully deleted ephemeral ChromaDB collection for session: {session_id}")
            return True
        except Exception as e:
            logger.debug(f"Ephemeral ChromaDB collection cleanup skipped or failed: {e}")
            return False


# Global instance
rag_service = RAGService()
