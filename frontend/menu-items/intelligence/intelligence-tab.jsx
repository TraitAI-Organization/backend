// assets
import { TableOutlined } from '@ant-design/icons';

// icons
const icons = {
  TableOutlined
};

// ==============================|| MENU ITEMS - INTELLIGENCE ||============================== //

const intelligenceTab = {
  id: 'group-intelligence',
  title: 'Intelligence',
  type: 'group',
  children: [
    {
      id: 'crop-studio',
      title: 'Crop Studio',
      type: 'item',
      url: '/dashboard/crop-studio',
      icon: icons.TableOutlined,
      breadcrumbs: true
    }
  ]
};

export default intelligenceTab;
