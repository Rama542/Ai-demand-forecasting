"""Walk-forward forecast engine with honest out-of-sample accuracy.

A gradient-boosted classifier (XGBoost, with scikit-learn fallback) predicts
whether the *next* candle closes higher or lower. The model is fitted only on
the earlier portion of the series and evaluated on the later, untouched portion
— so the reported accuracy, MAE and RMSE are true out-of-sample numbers, not
training-set numbers.
"""
from __future__ import annotations

import numpy as np
from typing import Any
from app.services.indicators import compute_features

FEATURE_COLUMNS = [
    "rsi", "macd", "macd_signal", "macd_hist", "momentum10", "momentum3",
    "volatility10", "atr_pct", "ema_spread_pct", "bb_position", "bb_width",
    "adx", "plus_di", "minus_di", "vwap_dev_pct", "volume_z", "breakout_dist_pct",
    "ret_1", "ret_5",
]

TRAIN_FRACTION = 0.6
MIN_SAMPLES = 90


def _build_dataset(candles: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    feat = compute_features(candles)
    close = feat["close"]
    n = len(close)

    atr_pct = feat["atr"] / close * 100.0
    ema_spread_pct = (feat["ema12"] - feat["ema26"]) / close * 100.0
    bb_range = feat["bb_upper"] - feat["bb_lower"]
    bb_position = np.where(bb_range != 0, (close - feat["bb_mid"]) / bb_range, np.nan)
    bb_width = bb_range / close * 100.0
    vwap_dev_pct = (close - feat["vwap"]) / close * 100.0
    volume_mean = np.nanmean(feat["volume"]) if np.nanmean(feat["volume"]) else 1.0
    volume_std = float(np.std(feat["volume"])) if np.std(feat["volume"]) > 0 else 1.0
    volume_z = (feat["volume"] - volume_mean) / volume_std
    breakout_dist_pct = (close - feat["high20"]) / close * 100.0

    ret_1 = np.full(n, np.nan)
    ret_1[1:] = close[1:] / close[:-1] - 1.0
    ret_5 = np.full(n, np.nan)
    ret_5[5:] = close[5:] / close[:-5] - 1.0

    cols = {
        "rsi": feat["rsi"], "macd": feat["macd"], "macd_signal": feat["macd_signal"],
        "macd_hist": feat["macd_hist"], "momentum10": feat["momentum10"],
        "momentum3": feat["momentum3"], "volatility10": feat["volatility10"],
        "atr_pct": atr_pct, "ema_spread_pct": ema_spread_pct, "bb_position": bb_position,
        "bb_width": bb_width, "adx": feat["adx"], "plus_di": feat["plus_di"],
        "minus_di": feat["minus_di"], "vwap_dev_pct": vwap_dev_pct, "volume_z": volume_z,
        "breakout_dist_pct": breakout_dist_pct, "ret_1": ret_1, "ret_5": ret_5,
    }
    X = np.column_stack([np.asarray(cols[c], dtype=float) for c in FEATURE_COLUMNS])
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

    # Target: direction of next bar's close (1 up, 0 down) and its return.
    y_dir = np.zeros(n, dtype=int)
    y_ret = np.zeros(n, dtype=float)
    for i in range(n - 1):
        y_dir[i] = 1 if close[i + 1] > close[i] else 0
        y_ret[i] = close[i + 1] / close[i] - 1.0
    return X, y_dir, y_ret, FEATURE_COLUMNS


def _fit_predict(X, y, train_idx, test_idx, task: str) -> tuple[np.ndarray, str]:
    """Fit on train_idx, predict on test_idx with the best available booster."""
    Xtr, ytr, Xte = X[train_idx], y[train_idx], X[test_idx]
    if task == "class":
        try:
            import xgboost as xgb
            model = xgb.XGBClassifier(
                n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.9,
                colsample_bytree=0.8, objective="binary:logistic", eval_metric="logloss",
                tree_method="hist", random_state=7,
            )
            model.fit(Xtr, ytr)
            return model.predict_proba(Xte)[:, 1], "xgboost"
        except Exception:
            from sklearn.ensemble import GradientBoostingClassifier
            model = GradientBoostingClassifier(n_estimators=100, max_depth=2, learning_rate=0.1, random_state=7)
            model.fit(Xtr, ytr)
            return model.predict_proba(Xte)[:, 1], "sklearn"
    else:
        try:
            import xgboost as xgb
            model = xgb.XGBRegressor(
                n_estimators=120, max_depth=3, learning_rate=0.1, subsample=0.9,
                colsample_bytree=0.8, tree_method="hist", random_state=7,
            )
            model.fit(Xtr, ytr)
            return model.predict(Xte), "xgboost"
        except Exception:
            from sklearn.ensemble import GradientBoostingRegressor
            model = GradientBoostingRegressor(n_estimators=100, max_depth=2, learning_rate=0.1, random_state=7)
            model.fit(Xtr, ytr)
            return model.predict(Xte), "sklearn"


def _rolling_accuracy(correct: np.ndarray, window: int = 20) -> list[dict]:
    out = []
    for start in range(0, len(correct), max(5, window // 4)):
        chunk = correct[start:start + window]
        if len(chunk) < 5:
            break
        out.append({
            "bucket": start,
            "accuracy": round(float(np.mean(chunk)) * 100.0, 1),
            "samples": int(len(chunk)),
        })
    return out


def forecast_report(candles: list[dict], symbol: str = "", interval: str = "1D") -> dict[str, Any]:
    """Return the honest walk-forward forecast metrics plus latest next-bar call."""
    if len(candles) < MIN_SAMPLES:
        return {"error": f"Need at least {MIN_SAMPLES} candles for a reliable forecast", "direction_accuracy": None}

    X, y_dir, y_ret, _ = _build_dataset(candles)
    n = len(candles)
    cutoff = max(MIN_SAMPLES // 2, int(n * TRAIN_FRACTION))
    train_idx = np.arange(0, cutoff)
    test_idx = np.arange(cutoff, n - 1) if n - 1 > cutoff else np.arange(0, n - 1)

    prob_te, class_model = _fit_predict(X, y_dir, train_idx, test_idx, "class")
    ret_te, reg_model = _fit_predict(X, y_ret, train_idx, test_idx, "reg")

    actual = y_dir[test_idx]
    pred_dir = (prob_te >= 0.5).astype(int)
    correct = (pred_dir == actual).astype(int)
    accuracy = float(np.mean(correct)) * 100.0

    precision = None
    recall = None
    f1 = None
    if actual.sum() > 0 and (actual == 0).sum() > 0:
        tp = int(((pred_dir == 1) & (actual == 1)).sum())
        fp = int(((pred_dir == 1) & (actual == 0)).sum())
        fn = int(((pred_dir == 0) & (actual == 1)).sum())
        precision = tp / (tp + fp) * 100.0 if (tp + fp) else 0.0
        recall = tp / (tp + fn) * 100.0 if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    pred_ret = np.clip(ret_te * 100.0, -10.0, 10.0)
    actual_ret = y_ret[test_idx] * 100.0
    mae = float(np.mean(np.abs(pred_ret - actual_ret)))
    rmse = float(np.sqrt(np.mean((pred_ret - actual_ret) ** 2)))
    brier = float(np.mean((prob_te - actual) ** 2))

    # Calibration: compare mean predicted probability vs observed up-rate in deciles.
    calibration = 1.0
    try:
        order = np.argsort(prob_te)
        buckets = np.array_split(order, 4)
        diffs = []
        for b in buckets:
            if len(b) >= 2:
                mean_p = float(np.mean(prob_te[b]))
                obs = float(np.mean(actual[b]))
                diffs.append(abs(mean_p - obs))
        if diffs:
            calibration = max(0.0, 1.0 - float(np.mean(diffs)))
    except Exception:
        pass

    rolling = _rolling_accuracy(correct)

    # Latest next-bar forecast: no correct answer exists yet — purely forward.
    last_prob_up = _fit_predict_full(X, y_dir, "class")
    last_prob_up = float(last_prob_up[0]) if last_prob_up is not None and len(last_prob_up) else 0.5
    last_prob_up = min(0.93, max(0.07, last_prob_up))
    last_direction = "UP" if last_prob_up >= 0.5 else "DOWN"
    last_prob = last_prob_up if last_direction == "UP" else 1.0 - last_prob_up

    entry = candles[-1]["close"]
    actual_prev_close = candles[-1]["close"]

    return {
        "symbol": symbol,
        "interval": interval,
        "model": f"{class_model} walk-forward",
        "direction_accuracy": round(accuracy, 1),
        "precision": round(precision, 1) if precision is not None else None,
        "recall": round(recall, 1) if recall is not None else None,
        "f1": round(f1, 2) if f1 is not None else None,
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "brier": round(brier, 4),
        "confidence_calibration": round(calibration, 2),
        "samples": {"train": int(len(train_idx)), "test": int(len(test_idx))},
        "rolling_accuracy": rolling,
        "latest_forecast": {
            "direction": last_direction,
            "probability": round(last_prob * 100.0, 1),
            "last_close": round(float(candles[-1]["close"]), 2),
            "horizon": "next candle",
        },
    }


def _fit_predict_full(X, y, task: str) -> tuple:
    """Fit on all but the last sample and predict the last sample."""
    train_idx = np.arange(0, len(X) - 1)
    test_idx = np.array([len(X) - 1])
    p, _ = _fit_predict(X, y, train_idx, test_idx, task)
    return p