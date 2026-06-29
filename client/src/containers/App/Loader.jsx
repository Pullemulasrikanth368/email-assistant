import React from "react";
import "../../scss/loader.scss";

const Loader = ({ loader }) => {
  if (!loader) return null;

  return (
    <div className="loaderWrapper">
      <div className="spinner"></div>
    </div>
  );
};

export default Loader;