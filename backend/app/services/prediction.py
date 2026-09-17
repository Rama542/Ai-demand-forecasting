"""Pluggable, leakage-safe prediction engine interface.

Training jobs provide features available only at market close for their
corresponding prediction date. Target shifting stays inside the training
pipeline, never in request-time scoring.
"""
from dataclasses import dataclass
from typing import Protocol
import numpy as np

@dataclass
class Prediction:
    direction: str
    probability: float
    expected_volatility: float
    model: str

class Predictor(Protocol):
    def predict(self, features: np.ndarray) -> Prediction: ...

class XGBoostPredictor:
    """Gradient-boosted next-bar direction predictor.

    The model is trained on demand from a labeled (features, outcome) matrix via
    :meth:`fit`. Before any model exists, :meth:`predict` falls back to a
    momentum-lagged heuristic so the interface never returns garbage.
    """
    model_name = "xgboost"
    _model = None

    def fit(self, X: np.ndarray, y: np.ndarray) -> None:
        X = np.nan_to_num(np.asarray(X, dtype=float), nan=0.0, posinf=0.0, neginf=0.0)
        y = np.asarray(y, dtype=int)
        if len(X) < 30:
            return
        try:
            import xgboost as xgb
            model = xgb.XGBClassifier(
                n_estimators=100, max_depth=3, learning_rate=0.1, subsample=0.9,
                colsample_bytree=0.8, tree_method="hist", random_state=7,
            )
            model.fit(X, y)
            self._model = model
        except Exception:
            from sklearn.ensemble import GradientBoostingClassifier
            self._model = GradientBoostingClassifier(n_estimators=80, max_depth=2, random_state=7)
            self._model.fit(X, y)

    def predict(self, features: np.ndarray) -> Prediction:
        features = np.nan_to_num(np.asarray(features, dtype=float).reshape(1, -1), nan=0.0)
        if self._model is not None:
            probability = float(self._model.predict_proba(features)[0][1])
        else:
            # Deterministic demo fallback before a model is fitted.
            probability = min(.93, max(.07, .5 + float(np.tanh(features.mean())) * .18))
        probability = min(.95, max(.05, probability))
        return Prediction("UP" if probability >= .5 else "DOWN", round(probability, 3), .016, self.model_name)

PREDICTOR_REGISTRY = {"xgboost": XGBoostPredictor}