import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

import 'bootstrap/dist/css/bootstrap.css';
import 'primereact/resources/themes/lara-light-blue/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import 'react-toastify/dist/ReactToastify.css';

import router from './containers/App/Router.jsx';

const App = () => (
  <>
    <ToastContainer position="top-right" />
    <RouterProvider router={router} />
  </>
);

export default App;
