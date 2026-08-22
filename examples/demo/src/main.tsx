import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import '@huiyun/data-grid/style.css';
import { DemoApp } from './App';
import './demo.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2657d9',
          borderRadius: 8,
          colorBgLayout: '#f3f5f8',
          fontFamily:
            "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
      }}
    >
      <AntApp>
        <DemoApp />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
