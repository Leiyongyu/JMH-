import { Layout, Menu, Badge, Space, Button, Avatar, Dropdown } from 'antd';
import {
  AppstoreOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  LogoutOutlined,
  TeamOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/cart';

const { Header, Content, Sider } = Layout;

export function AppLayout() {
  const { user, logout, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const cartItems = useCart();
  const cartCount = cartItems.reduce((s, it) => s + it.qty, 0);

  const selectedKey =
    location.pathname.startsWith('/inventory')
      ? 'inventory'
      : location.pathname.startsWith('/products')
        ? 'products'
        : location.pathname.startsWith('/users')
          ? 'users'
          : location.pathname.startsWith('/access')
            ? 'access'
        : location.pathname.startsWith('/cart')
          ? 'cart'
          : location.pathname.startsWith('/orders')
            ? 'orders'
            : '';

  const menuItems = [
    ...(isAdmin ? [{ key: 'inventory', icon: <DatabaseOutlined />, label: <Link to="/inventory">库存看板</Link> }] : []),
    { key: 'products', icon: <AppstoreOutlined />, label: <Link to="/products">商品</Link> },
    { key: 'orders', icon: <FileTextOutlined />, label: <Link to="/orders">我的订单</Link> },
    ...(isAdmin
      ? [
          { key: 'users', icon: <TeamOutlined />, label: <Link to="/users">用户管理</Link> },
          { key: 'access', icon: <SettingOutlined />, label: <Link to="/access">分组权限</Link> },
        ]
      : []),
  ];

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        width={200}
        theme="light"
        breakpoint="lg"
        collapsedWidth="0"
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ fontWeight: 'bold', fontSize: 18, color: '#1677ff' }}>分销中台系统</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          style={{ height: 'calc(100% - 64px)', borderRight: 0, paddingTop: 16 }}
          items={menuItems}
        />
      </Sider>
      <Layout style={{ height: '100vh' }}>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          <Space size={24}>
            <Badge count={cartCount} size="small" offset={[2, 0]}>
              <Button
                type="text"
                icon={<ShoppingCartOutlined style={{ fontSize: 20 }} />}
                onClick={() => navigate('/cart')}
              />
            </Badge>
            
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'logout',
                    label: '退出登录',
                    icon: <LogoutOutlined />,
                    onClick: logout,
                  },
                ],
              }}
              placement="bottomRight"
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar icon={<UserOutlined />} />
                <span style={{ fontWeight: 500 }}>{user?.displayName || user?.email}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content
          style={{
            padding: 24,
            background: '#f9f9f9',
            overflow: 'auto',
            height: 'calc(100vh - 64px)',
          }}
        >
          <div style={{ maxWidth: 1400, margin: '0 auto' }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
