// assets
import { MessageOutlined } from '@ant-design/icons';

// icons
const icons = {
  MessageOutlined
};

// ==============================|| MENU ITEMS - COPILOT ||============================== //

const coPilotTab = {
  id: 'group-copilot',
  title: 'CoPilot',
  type: 'group',
  children: [
    {
      id: 'fieldmind',
      title: 'FieldMind',
      type: 'item',
      url: '/dashboard/fieldmind',
      icon: icons.MessageOutlined,
      breadcrumbs: false
    }
  ]
};

export default coPilotTab;
