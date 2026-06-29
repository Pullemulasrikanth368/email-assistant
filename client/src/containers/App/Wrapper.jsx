import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const Wrapper = () => (
  <div className="ea-layout">
    <Sidebar />
    <main className="ea-main p-2">
      <Outlet />
    </main>
  </div>
);

export default Wrapper;
