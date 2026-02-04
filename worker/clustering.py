"""Embedding and clustering module for comment analysis."""

from __future__ import annotations

import re
from typing import List, Tuple

import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score

# Lazy-loaded model
_MODEL = None

# Noise patterns to filter out
NOISE_PATTERNS = [
    r'^https?://',  # URLs only
    r'^[^\w\s]+$',  # Emoji/symbols only
    r'^(first|nice|lol|lmao|wow|cool|great|awesome|good|bad|yes|no|ok|okay|omg|wtf|w+|草+|ワロタ|www+|笑+)$',
]
NOISE_REGEX = re.compile('|'.join(NOISE_PATTERNS), re.IGNORECASE)

MIN_TEXT_LENGTH = 8  # Minimum characters for valid comment


def _get_model(model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> SentenceTransformer:
    """Get or initialize the embedding model (lazy loading)."""
    global _MODEL
    if _MODEL is None:
        print("[clustering] Loading MiniLM model (first time may download ~80MB)...")
        _MODEL = SentenceTransformer(model_name)
        print("[clustering] Model loaded.")
    return _MODEL


def preprocess_texts(texts: List[str]) -> Tuple[List[str], List[int]]:
    """
    Filter out noise comments and return clean texts with their original indices.
    
    Returns:
        Tuple of (clean_texts, original_indices)
    """
    clean_texts = []
    original_indices = []
    seen = set()  # For deduplication
    
    for i, text in enumerate(texts):
        text = text.strip()
        
        # Skip too short
        if len(text) < MIN_TEXT_LENGTH:
            continue
        
        # Skip noise patterns
        if NOISE_REGEX.match(text):
            continue
        
        # Skip duplicates
        normalized = text.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        
        clean_texts.append(text)
        original_indices.append(i)
    
    return clean_texts, original_indices


def embed_comments(texts: List[str]) -> np.ndarray:
    """
    MiniLM で Embedding。正規化済みでコサイン類似度用に安定。

    Returns:
        numpy array of shape (n_comments, 384), dtype float32
    """
    if not texts:
        return np.array([], dtype=np.float32)

    model = _get_model()
    emb = model.encode(
        texts,
        batch_size=32,
        show_progress_bar=False,
        normalize_embeddings=True,  # コサイン類似度前提で安定
    )
    return np.asarray(emb, dtype=np.float32)


def choose_k_by_silhouette(
    embeddings: np.ndarray,
    k_min: int = 2,
    k_max: int = 8,
    min_cluster_size: int = 3,
) -> int:
    """
    Silhouette法で最適なクラスタ数を選択。
    
    Args:
        embeddings: Shape (n_samples, n_features)
        k_min: Minimum number of clusters
        k_max: Maximum number of clusters
        min_cluster_size: Minimum samples per cluster (reject k if any cluster is smaller)
    
    Returns:
        Optimal k value
    """
    n = embeddings.shape[0]
    
    # Bounds check
    k_min = max(2, k_min)
    k_max = min(k_max, n - 1)  # Need at least k+1 samples
    
    if k_max < k_min:
        return k_min
    
    best_k = k_min
    best_score = -1
    
    for k in range(k_min, k_max + 1):
        try:
            kmeans = KMeans(n_clusters=k, random_state=42, n_init="auto")
            labels = kmeans.fit_predict(embeddings)
            
            # Check minimum cluster size
            cluster_sizes = np.bincount(labels)
            if cluster_sizes.min() < min_cluster_size:
                continue
            
            score = silhouette_score(embeddings, labels)
            
            if score > best_score:
                best_score = score
                best_k = k
                
        except Exception:
            continue
    
    print(f"[clustering] Silhouette method selected k={best_k} (score={best_score:.3f})")
    return best_k


def cluster_comments(
    embeddings: np.ndarray,
    n_clusters: int | None = None,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    KMeans でクラスタリングし、PCA で 2D 座標生成。

    Args:
        embeddings: Shape (n_samples, n_features)
        n_clusters: クラスタ数（None の場合はSilhouette法で自動決定）

    Returns:
        Tuple of (labels, coords_2d, centroids)
        - labels: 各サンプルのクラスタ番号
        - coords_2d: 可視化用 2D 座標 (n, 2)
        - centroids: クラスタ中心 (k, d)
    """
    n = embeddings.shape[0]
    if n == 0:
        return np.array([]), np.array([]).reshape(0, 2), np.array([])

    # Use Silhouette method if n_clusters not specified
    if n_clusters is None:
        k = choose_k_by_silhouette(embeddings)
    else:
        k = n_clusters
    
    k = min(k, n)  # クラスタ数はサンプル数を超えない

    print(f"[clustering] Clustering {n} comments into {k} clusters")

    kmeans = KMeans(n_clusters=k, random_state=42, n_init="auto")
    labels = kmeans.fit_predict(embeddings)
    centroids = kmeans.cluster_centers_

    # PCA で 2D 可視化用座標生成
    if n >= 2:
        pca = PCA(n_components=2, random_state=42)
        coords = pca.fit_transform(embeddings)
        # [-1, 1] に正規化
        for dim in range(2):
            min_val, max_val = coords[:, dim].min(), coords[:, dim].max()
            if max_val > min_val:
                coords[:, dim] = 2 * (coords[:, dim] - min_val) / (max_val - min_val) - 1
    else:
        coords = np.zeros((n, 2))

    return labels, coords, centroids


def select_representatives(
    texts: List[str],
    embeddings: np.ndarray,
    labels: np.ndarray,
    centroids: np.ndarray,
    top_k: int = 3,
    min_length: int = 20,
    similarity_threshold: float = 0.95,
) -> List[List[int]]:
    """
    各クラスタの代表コメントを選択（改善版）。
    
    - 中心に近いコメントを優先
    - 短すぎるコメントは下げ目に補正
    - 重複（類似度が高すぎる）コメントはスキップ
    
    Returns:
        cluster_to_indices: 各クラスタの代表コメント index のリスト
    """
    k = centroids.shape[0]
    reps: List[List[int]] = []

    for c in range(k):
        idxs = np.where(labels == c)[0]
        if len(idxs) == 0:
            reps.append([])
            continue

        # コサイン類似度（正規化済みなので内積）
        sims = embeddings[idxs] @ centroids[c]
        
        # 長さ補正: 短いコメントは類似度を下げる
        length_boost = np.array([
            1.0 + 0.1 * np.log(max(len(texts[idx]), 1) / min_length)
            for idx in idxs
        ])
        adjusted_sims = sims * np.clip(length_boost, 0.5, 1.5)
        
        # 類似度が高い順にソート
        order = np.argsort(-adjusted_sims)
        
        # 重複を避けながら代表を選択
        selected = []
        selected_embeddings = []
        
        for rank_idx in order:
            if len(selected) >= top_k:
                break
            
            actual_idx = idxs[rank_idx]
            candidate_emb = embeddings[actual_idx]
            
            # 既存の代表と類似度が高すぎる場合はスキップ
            is_duplicate = False
            for prev_emb in selected_embeddings:
                if np.dot(candidate_emb, prev_emb) > similarity_threshold:
                    is_duplicate = True
                    break
            
            if not is_duplicate:
                selected.append(actual_idx)
                selected_embeddings.append(candidate_emb)
        
        reps.append(selected)

    return reps


def generate_cluster_labels(n_clusters: int) -> List[str]:
    """クラスタのラベルを生成（MVP: 仮ラベル、将来はLLMで生成）"""
    base_labels = ["意見グループ A", "意見グループ B", "意見グループ C", 
                   "意見グループ D", "意見グループ E", "意見グループ F"]
    return [base_labels[i] if i < len(base_labels) else f"意見グループ {i+1}" 
            for i in range(n_clusters)]
