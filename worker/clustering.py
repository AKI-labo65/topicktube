"""Embedding and clustering module for comment analysis."""

from __future__ import annotations

from typing import List, Tuple

import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA

# Lazy-loaded model
_MODEL = None


def _get_model(model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> SentenceTransformer:
    """Get or initialize the embedding model (lazy loading)."""
    global _MODEL
    if _MODEL is None:
        print("[clustering] Loading MiniLM model (first time may download ~80MB)...")
        _MODEL = SentenceTransformer(model_name)
        print("[clustering] Model loaded.")
    return _MODEL


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


def choose_k(n: int) -> int:
    """コメント数に応じて壊れにくいクラスタ数を決定（MVP用）"""
    return max(2, min(6, n // 20))


def cluster_comments(
    embeddings: np.ndarray,
    n_clusters: int | None = None,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    KMeans でクラスタリングし、PCA で 2D 座標生成。

    Args:
        embeddings: Shape (n_samples, n_features)
        n_clusters: クラスタ数（None の場合は自動決定）

    Returns:
        Tuple of (labels, coords_2d, centroids)
        - labels: 各サンプルのクラスタ番号
        - coords_2d: 可視化用 2D 座標 (n, 2)
        - centroids: クラスタ中心 (k, d)
    """
    n = embeddings.shape[0]
    if n == 0:
        return np.array([]), np.array([]).reshape(0, 2), np.array([])

    k = n_clusters if n_clusters else choose_k(n)
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
) -> List[List[int]]:
    """
    各クラスタの中心に近いコメント index を返す（top_k 件）。

    正規化済み embeddings でコサイン類似度（内積）を使用。

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
        # 類似度が高い順
        order = np.argsort(-sims)[:top_k]
        reps.append(idxs[order].tolist())

    return reps


def generate_cluster_labels(n_clusters: int) -> List[str]:
    """クラスタのラベルを生成（MVP: 仮ラベル、将来はLLMで生成）"""
    base_labels = ["意見グループ A", "意見グループ B", "意見グループ C", 
                   "意見グループ D", "意見グループ E", "意見グループ F"]
    return [base_labels[i] if i < len(base_labels) else f"意見グループ {i+1}" 
            for i in range(n_clusters)]
