from typing import List, Dict, Any, Optional
import chromadb
from backend.utils import logger, get_gemini_api_key

class RAGService:
  """RAG & Embedding service for indexing and retrieving resume and job description chunks using ChromaDB."""
  def __init__(self):
    # EphemeralClient is completely in-memory, leaving 0 files on disk
    self.chroma_client = chromadb.EphemeralClient()

  def _call_gemini_embedding(self, texts: List[str]) -> List[List[float]]:
    """Generate embeddings for a list of texts using Gemini's text-embedding-004 model."""
    api_key = get_gemini_api_key("resume")
    if not api_key:
      logger.warning("No Gemini API key found for generating embeddings. Returning mock embeddings.")
      # Fallback mock embedding dimension (768)
      return [[0.0] * 768 for _ in texts]

    # Try google.genai first (new SDK)
    try:
      from google import genai
      client = genai.Client(api_key=api_key)
      embeddings = []
      for text in texts:
        response = client.models.embed_content(
          model='text-embedding-004',
          content=text,         # new SDK uses 'content' (singular)
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

  def add_documents(self, session_id: str, texts: List[str], metadatas: Optional[List[Dict[str, Any]]] = None) -> bool:
    """Add text chunks into ephemeral ChromaDB session collection."""
    if not texts:
      return False

    try:
      # ChromaDB collection names must start with a letter and contain only alphanumeric/underscores/hyphens, length 3-63
      collection_name = f"session_{session_id}".replace("-", "_")
      collection = self.chroma_client.get_or_create_collection(name=collection_name)

      embeddings = self._call_gemini_embedding(texts)
      metadatas = metadatas or [{} for _ in texts]
      
      # Generate unique IDs for each chunk
      ids = [f"chunk_{session_id}_{i}" for i in range(len(texts))]

      collection.add(
        ids=ids,
        documents=texts,
        embeddings=embeddings,
        metadatas=metadatas
      )
      logger.info(f"Indexed {len(texts)} document chunks in ChromaDB for session {session_id}")
      return True
    except Exception as e:
      logger.error(f"Failed to add documents to ChromaDB: {e}")
      return False

  def query_context(self, session_id: str, query: str, top_k: int = 3) -> List[str]:
    """Retrieve most semantically relevant chunks for a given query from ChromaDB."""
    try:
      collection_name = f"session_{session_id}".replace("-", "_")
      # Check if collection exists
      try:
        collection = self.chroma_client.get_collection(name=collection_name)
      except Exception:
        logger.warning(f"ChromaDB collection for session {session_id} not found.")
        return []

      query_embeddings = self._call_gemini_embedding([query])
      
      results = collection.query(
        query_embeddings=query_embeddings,
        n_results=top_k
      )

      # Extract documents from results structure
      if results and 'documents' in results and results['documents']:
        # documents is a list of lists of strings
        flat_docs = [doc for sublist in results['documents'] for doc in sublist]
        return flat_docs
      return []
    except Exception as e:
      logger.error(f"Failed to query ChromaDB context: {e}")
      return []

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
