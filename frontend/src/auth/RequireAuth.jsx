import PropTypes from 'prop-types';
import { Navigate, useLocation } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import { useAuth } from './AuthContext';

/**
 * Wrap any route element that requires a signed-in Firebase user.
 *
 *   <RequireAuth><DashboardLayout /></RequireAuth>
 *
 * While the AuthContext is determining auth state (Firebase resolves
 * onAuthStateChanged async on first load), we render a centered spinner so the
 * user doesn't see a flash of /login on every reload. When unauthenticated, we
 * redirect to /login and stash the original URL in location.state.from for
 * post-login bounces (not used yet, future-proofing).
 */
export default function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

RequireAuth.propTypes = { children: PropTypes.node };
