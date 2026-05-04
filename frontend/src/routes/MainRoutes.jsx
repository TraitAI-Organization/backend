import { lazy } from 'react';

// project imports
import Loadable from 'components/Loadable';
import DashboardLayout from 'layout/Dashboard';

// render- Dashboard
const DashboardDefault = Loadable(lazy(() => import('pages/overview/dashboard/default')));
const CropStudioDefault = Loadable(lazy(() => import('pages/intelligence/crop-studio/default')));
const FieldMindDefault = Loadable(lazy(() => import('pages/copilot/fieldmind/default')));

// ==============================|| MAIN ROUTING ||============================== //

const MainRoutes = {
  path: '/',
  element: <DashboardLayout />,
  children: [
    {
      path: 'dashboard',
      children: [
        {
          index: true,
          element: <CropStudioDefault />
        },
        {
          path: 'default',
          element: <DashboardDefault />
        },
        {
          path: 'crop-studio',
          element: <CropStudioDefault />
        },
        {
          path: 'fieldmind',
          element: <FieldMindDefault />
        }
      ]
    }
    // {
    //   path: 'typography',
    //   element: <Typography />
    // },
    // {
    //   path: 'color',
    //   element: <Color />
    // },
    // {
    //   path: 'shadow',
    //   element: <Shadow />
    // },
    // {
    //   path: 'sample-page',
    //   element: <SamplePage />
    // }
  ]
};

export default MainRoutes;
