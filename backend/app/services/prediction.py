"""Pluggable, leakage-safe prediction engine interface.

Training jobs should provide features available only at market close for their
corresponding prediction date. This module intentionally keeps target shifting
inside the training pipeline, never in request-time scoring.
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
    """Default engine. Load a versioned Booster in production."""
    model_name = "xgboost"
    def predict(self, features: np.ndarray) -> Prediction:
        # Model loading is injected by the repository/service layer. Safe demo fallback.
        probability = min(.93, max(.07, .5 + float(np.tanh(features.mean())) * .18))
        return Prediction("UP" if probability >= .5 else "DOWN", round(probability, 3), .016, self.model_name)

PREDICTOR_REGISTRY = {"xgboost": XGBoostPredictor}
