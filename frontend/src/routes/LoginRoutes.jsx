import { lazy } from 'react';

// project imports
import Loadable from 'components/Loadable';

// jwt auth
const LoginPage = Loadable(lazy(() => import('pages/auth/Login')));

// ==============================|| AUTH ROUTING ||============================== //

const LoginRoutes = {
  path: '/',
  children: [
    { index: true, element: <LoginPage /> },
    { path: 'login', element: <LoginPage /> }
  ]
};

export default LoginRoutes;
