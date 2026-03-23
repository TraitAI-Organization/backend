"""
Feature engineering for yield prediction
"""
import pandas as pd
import numpy as np
from typing import Dict, Any, Tuple, List
import logging

logger = logging.getLogger(__name__)


class FeatureEngineer:
    """
    Handles feature engineering for the yield prediction model.

    Features include:
    - Numeric: acres, lat, long, N, P, K rates, etc.
    - Categorical: crop, variety, state, county (one-hot or target encoded)
    - Derived: N:P ratio, event counts, timing features, regional averages
    """

    def __init__(self):
        self.categorical_columns = ['crop', 'variety', 'state', 'county']
        self.numeric_columns = [
            'acres', 'lat', 'long', 'season',
            'totalN_per_ac', 'totalP_per_ac', 'totalK_per_ac',
            'n_p_ratio', 'n_k_ratio', 'p_k_ratio'
        ]
        self.event_columns = [
            'event_count', 'spray_count', 'fertilizer_count', 'tillage_count',
            'days_plant_to_first_fert', 'days_first_to_last_fert',
            'avg_days_between_ops'
        ]

        # Will be fitted on training data
        self.crop_avgs = None
        self.state_avgs = None
        self.county_avgs = None

    def safe_divide(self, a: float, b: float, default: float = 0.0) -> float:
        """Safely divide, returning default if divisor is 0."""
        return a / b if b != 0 else default

    def calculate_nutrient_ratios(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate N:P, N:K, P:K ratios."""
        df = df.copy()
        df['n_p_ratio'] = self.safe_divide(df['totalN_per_ac'], df['totalP_per_ac'])
        df['n_k_ratio'] = self.safe_divide(df['totalN_per_ac'], df['totalK_per_ac'])
        df['p_k_ratio'] = self.safe_divide(df['totalP_per_ac'], df['totalK_per_ac'])
        return df

    def calculate_intensity_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate management intensity features."""
        df = df.copy()

        # Total nutrient application (sum of N+P+K)
        df['total_nutrients_lb_ac'] = (
            df['totalN_per_ac'].fillna(0) +
            df['totalP_per_ac'].fillna(0) +
            df['totalK_per_ac'].fillna(0)
        )

        # Nutrient application per acre (normalized by acres is already per acre)
        # but we can create interaction with field size
        df['nutrient_x_acres'] = df['total_nutrients_lb_ac'] * df['acres']

        return df

    def calculate_regional_avgs(
        self,
        df: pd.DataFrame,
        n_years: int = 3,
        min_samples: int = 5
    ) -> pd.DataFrame:
        """
        Calculate rolling regional averages for context.

        For each record, compute:
        - County average yield over past N years for same crop
        - State average yield
        - Crop average yield overall
        """
        df = df.copy()

        # Sort by season
        df = df.sort_values('season')

        # County-crop-season averages
        if 'county' in df.columns and 'crop' in df.columns:
            county_crop_avg = (
                df.groupby(['county', 'crop', 'season'])['yield_bu_ac']
                .transform('mean')
            )
            df['county_crop_avg_yield'] = county_crop_avg

            # 3-year rolling average for county-crop
            rolling = (
                df.groupby(['county', 'crop'])['yield_bu_ac']
                .rolling(window=n_years, min_periods=1)
                .mean()
                .reset_index(level=[0, 1], drop=True)
            )
            df['county_crop_3yr_avg'] = rolling

        # State-crop averages
        if 'state' in df.columns and 'crop' in df.columns:
            state_crop_avg = (
                df.groupby(['state', 'crop'])['yield_bu_ac']
                .transform('mean')
            )
            df['state_crop_avg_yield'] = state_crop_avg

        # Overall crop average
        crop_avg = df.groupby('crop')['yield_bu_ac'].transform('mean')
        df['crop_overall_avg_yield'] = crop_avg

        # Difference from regional average (target leakage? Only if we use historical data properly)
        # For training, we need to ensure we're not using future data
        # For inference, we would compute these on the fly from historical data

        return df

    def encode_categoricals(
        self,
        df: pd.DataFrame,
        method: str = 'target',
        target_series: pd.Series = None
    ) -> pd.DataFrame:
        """
        Encode categorical variables.

        Methods:
        - 'onehot': One-hot encoding (simple, but increases dimensionality)
        - 'target': Target encoding (mean yield for each category)
        - 'frequency': Frequency encoding
        """
        df = df.copy()

        if method == 'onehot':
            for col in self.categorical_columns:
                if col in df.columns:
                    dummies = pd.get_dummies(df[col], prefix=col, drop_first=True, dummy_na=True)
                    df = pd.concat([df, dummies], axis=1)
                    df.drop(columns=[col], inplace=True)

        elif method == 'target':
            if target_series is None:
                raise ValueError("target_series required for target encoding")

            for col in self.categorical_columns:
                if col in df.columns:
                    # Compute mean target for each category
                    means = target_series.groupby(df[col]).mean()
                    df[f'{col}_encoded'] = df[col].map(means).fillna(target_series.mean())

        elif method == 'frequency':
            for col in self.categorical_columns:
                if col in df.columns:
                    freq = df[col].value_counts(normalize=True)
                    df[f'{col}_freq'] = df[col].map(freq).fillna(0)

        return df

    def create_interactions(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create interaction terms between important features."""
        df = df.copy()

        # Nutrient interactions with acres
        if 'totalN_per_ac' in df.columns and 'acres' in df.columns:
            df['N_x_acres'] = df['totalN_per_ac'] * df['acres']
        if 'totalP_per_ac' in df.columns and 'acres' in df.columns:
            df['P_x_acres'] = df['totalP_per_ac'] * df['acres']
        if 'totalK_per_ac' in df.columns and 'acres' in df.columns:
            df['K_x_acres'] = df['totalK_per_ac'] * df['acres']

        # Nutrient interactions with each other
        if 'totalN_per_ac' in df.columns and 'totalP_per_ac' in df.columns:
            df['N_x_P'] = df['totalN_per_ac'] * df['totalP_per_ac']
        if 'totalN_per_ac' in df.columns and 'totalK_per_ac' in df.columns:
            df['N_x_K'] = df['totalN_per_ac'] * df['totalK_per_ac']
        if 'totalP_per_ac' in df.columns and 'totalK_per_ac' in df.columns:
            df['P_x_K'] = df['totalP_per_ac'] * df['totalK_per_ac']

        return df

    def prepare_features(
        self,
        df: pd.DataFrame,
        target_series: pd.Series = None,
        fit: bool = True,
        calculate_regional: bool = True
    ) -> pd.DataFrame:
        """
        Main feature engineering pipeline.

        Args:
            df: Input DataFrame with raw features
            target_series: Target variable (yield_bu_ac) - required for target encoding
            fit: If True, fit encodings on this data; else use pre-fitted encodings
            calculate_regional: Whether to compute regional averages (requires yield data)

        Returns:
            DataFrame with engineered features ready for modeling
        """
        df = df.copy()

        # 1. Handle missing values
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        df[numeric_cols] = df[numeric_cols].fillna(0)

        # 2. Calculate ratios
        df = self.calculate_nutrient_ratios(df)

        # 3. Calculate intensity features
        df = self.calculate_intensity_features(df)

        # 4. Calculate regional averages (only on training data with yields)
        if calculate_regional and 'yield_bu_ac' in df.columns and fit:
            df = self.calculate_regional_avgs(df)

        # 5. Encode categoricals
        if target_series is not None:
            df = self.encode_categoricals(df, method='target', target_series=target_series)
        else:
            # For inference, we'll use stored encodings
            # For now, fallback to one-hot or frequency
            df = self.encode_categoricals(df, method='frequency')

        # 6. Create interactions
        df = self.create_interactions(df)

        # 7. Drop unnecessary columns
        # Keep only numeric columns that are useful for modeling
        feature_columns = [
            col for col in df.columns
            if df[col].dtype in [np.float64, np.int64] and col not in ['yield_bu_ac', 'field_season_id']
        ]

        return df[feature_columns]


def prepare_single_record_for_prediction(
    record: Dict[str, Any],
    feature_engineer: FeatureEngineer,
    crop_avg_yields: Dict[str, float] = None,
    state_avg_yields: Dict[str, float] = None,
    county_avg_yields: Dict[str, float] = None
) -> pd.DataFrame:
    """
    Prepare a single record (dictionary) for model prediction.

    This replicates the feature engineering steps from training but for a single input.
    """
    # Convert to DataFrame
    df = pd.DataFrame([record])

    # Add placeholder for regional averages if we have them
    if 'county' in record and record['county'] and county_avg_yields:
        # For now, we'll just add county average as a feature
        # In practice, we'd compute rolling averages from historical data
        df['county_avg_yield'] = county_avg_yields.get(record['county'], 0)
    if 'state' in record and record['state'] and state_avg_yields:
        df['state_avg_yield'] = state_avg_yields.get(record['state'], 0)
    if 'crop' in record and record['crop'] and crop_avg_yields:
        df['crop_avg_yield'] = crop_avg_yields.get(record['crop'], 0)

    # Apply feature engineering (without target encoding since we don't have target)
    df = feature_engineer.calculate_nutrient_ratios(df)
    df = feature_engineer.calculate_intensity_features(df)
    df = feature_engineer.create_interactions(df)

    # For inference, we need to ensure the feature set matches training
    # This will be handled by loading the feature list from the saved model

    return df