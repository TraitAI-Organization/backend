"""
Helper utilities
"""
import math
from typing import Optional


def safe_divide(a: float, b: float, default: float = 0.0) -> float:
    """Safely divide two numbers, returning default if divisor is zero."""
    return a / b if b != 0 else default


def round_to(value: float, decimals: int = 2) -> Optional[float]:
    """Round a value to specified decimals if not None."""
    if value is None:
        return None
    return round(value, decimals)


def calculate_cv(mean: float, std: float) -> Optional[float]:
    """Calculate coefficient of variation (%)."""
    if mean is None or std is None or mean == 0:
        return None
    return (std / mean) * 100


def format_yield(yield_bu_ac: float, decimals: int = 1) -> str:
    """Format yield value for display."""
    if yield_bu_ac is None:
        return "N/A"
    return f"{yield_bu_ac:.{decimals}f} bu/ac"


def get_percentile_rank(value: float, distribution: list[float]) -> float:
    """Calculate percentile rank of a value in a distribution."""
    if not distribution:
        return 0.0
    count_below = sum(1 for v in distribution if v < value)
    return (count_below / len(distribution)) * 100


def is_outlier(value: float, mean: float, std: float, threshold: float = 2.0) -> bool:
    """Check if a value is an outlier using z-score."""
    if std == 0:
        return False
    z_score = abs((value - mean) / std)
    return z_score > threshold


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate great-circle distance between two points on Earth (in km).
    """
    R = 6371  # Earth radius in km

    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)

    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad

    a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    return R * c