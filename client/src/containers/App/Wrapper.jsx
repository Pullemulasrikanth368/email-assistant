import React from 'react';
import { Outlet } from 'react-router-dom';

const Wrapper = () => (
  <div className="theme-light ltr-support" dir="ltr">
    <div className="wrapper">
      <main>
        <Outlet />
      </main>
    </div>
  </div>
);

export default Wrapper;
