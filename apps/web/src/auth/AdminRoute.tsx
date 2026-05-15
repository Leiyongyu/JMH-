import { Navigate, useLocation } from 'react-router-dom';
import { Spin, Result } from 'antd';
import { ReactNode } from 'react';
import { useAuth } from './AuthContext';

export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!isAdmin) {
    return <Result status="403" title="403" subTitle="仅管理员可访问该页面" />;
  }
  return <>{children}</>;
}

