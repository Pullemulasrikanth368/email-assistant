import{r as o}from"./index-RInzjnhF.js";import{u as x,P as N,a as _,O,f as s,R as A,T as J,C as S,S as X,g as q}from"./service-DljniXHu.js";function g(){return g=Object.assign?Object.assign.bind():function(a){for(var t=1;t<arguments.length;t++){var e=arguments[t];for(var r in e)({}).hasOwnProperty.call(e,r)&&(a[r]=e[r])}return a},g.apply(null,arguments)}function m(a){"@babel/helpers - typeof";return m=typeof Symbol=="function"&&typeof Symbol.iterator=="symbol"?function(t){return typeof t}:function(t){return t&&typeof Symbol=="function"&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},m(a)}function G(a,t){if(m(a)!="object"||!a)return a;var e=a[Symbol.toPrimitive];if(e!==void 0){var r=e.call(a,t);if(m(r)!="object")return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return(t==="string"?String:Number)(a)}function Q(a){var t=G(a,"string");return m(t)=="symbol"?t:t+""}function l(a,t,e){return(t=Q(t))in a?Object.defineProperty(a,t,{value:e,enumerable:!0,configurable:!0,writable:!0}):a[t]=e,a}var V={root:function(t){var e=t.props;return s("p-badge p-component",l({"p-badge-no-gutter":O.isNotEmpty(e.value)&&String(e.value).length===1,"p-badge-dot":O.isEmpty(e.value),"p-badge-lg":e.size==="large","p-badge-xl":e.size==="xlarge"},"p-badge-".concat(e.severity),e.severity!==null))}},W=`
@layer primereact {
    .p-badge {
        display: inline-block;
        border-radius: 10px;
        text-align: center;
        padding: 0 .5rem;
    }
    
    .p-overlay-badge {
        position: relative;
    }
    
    .p-overlay-badge .p-badge {
        position: absolute;
        top: 0;
        right: 0;
        transform: translate(50%,-50%);
        transform-origin: 100% 0;
        margin: 0;
    }
    
    .p-badge-dot {
        width: .5rem;
        min-width: .5rem;
        height: .5rem;
        border-radius: 50%;
        padding: 0;
    }
    
    .p-badge-no-gutter {
        padding: 0;
        border-radius: 50%;
    }
}
`,v=S.extend({defaultProps:{__TYPE:"Badge",__parentMetadata:null,value:null,severity:null,size:null,style:null,className:null,children:void 0},css:{classes:V,styles:W}});function w(a,t){var e=Object.keys(a);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(a);t&&(r=r.filter(function(n){return Object.getOwnPropertyDescriptor(a,n).enumerable})),e.push.apply(e,r)}return e}function Z(a){for(var t=1;t<arguments.length;t++){var e=arguments[t]!=null?arguments[t]:{};t%2?w(Object(e),!0).forEach(function(r){l(a,r,e[r])}):Object.getOwnPropertyDescriptors?Object.defineProperties(a,Object.getOwnPropertyDescriptors(e)):w(Object(e)).forEach(function(r){Object.defineProperty(a,r,Object.getOwnPropertyDescriptor(e,r))})}return a}var B=o.memo(o.forwardRef(function(a,t){var e=x(),r=o.useContext(N),n=v.getProps(a,r),i=v.setMetaData(Z({props:n},n.__parentMetadata)),f=i.ptm,d=i.cx,c=i.isUnstyled;_(v.css.styles,c,{name:"badge"});var u=o.useRef(null);o.useImperativeHandle(t,function(){return{props:n,getElement:function(){return u.current}}});var P=e({ref:u,style:n.style,className:s(n.className,d("root"))},v.getOtherProps(n),f("root"));return o.createElement("span",P,n.value)}));B.displayName="Badge";var ee={icon:function(t){var e=t.props;return s("p-button-icon p-c",l({},"p-button-icon-".concat(e.iconPos),e.label))},loadingIcon:function(t){var e=t.props,r=t.className;return s(r,{"p-button-loading-icon":e.loading})},label:"p-button-label p-c",root:function(t){var e=t.props,r=t.size,n=t.disabled;return s("p-button p-component",l(l(l(l({"p-button-icon-only":(e.icon||e.loading)&&!e.label&&!e.children,"p-button-vertical":(e.iconPos==="top"||e.iconPos==="bottom")&&e.label,"p-disabled":n,"p-button-loading":e.loading,"p-button-outlined":e.outlined,"p-button-raised":e.raised,"p-button-link":e.link,"p-button-text":e.text,"p-button-rounded":e.rounded,"p-button-loading-label-only":e.loading&&!e.icon&&e.label},"p-button-loading-".concat(e.iconPos),e.loading&&e.label),"p-button-".concat(r),r),"p-button-".concat(e.severity),e.severity),"p-button-plain",e.plain))}},y=S.extend({defaultProps:{__TYPE:"Button",__parentMetadata:null,badge:null,badgeClassName:null,className:null,children:void 0,disabled:!1,icon:null,iconPos:"left",label:null,link:!1,loading:!1,loadingIcon:null,outlined:!1,plain:!1,raised:!1,rounded:!1,severity:null,size:null,text:!1,tooltip:null,tooltipOptions:null,visible:!0},css:{classes:ee}});function E(a,t){var e=Object.keys(a);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(a);t&&(r=r.filter(function(n){return Object.getOwnPropertyDescriptor(a,n).enumerable})),e.push.apply(e,r)}return e}function j(a){for(var t=1;t<arguments.length;t++){var e=arguments[t]!=null?arguments[t]:{};t%2?E(Object(e),!0).forEach(function(r){l(a,r,e[r])}):Object.getOwnPropertyDescriptors?Object.defineProperties(a,Object.getOwnPropertyDescriptors(e)):E(Object(e)).forEach(function(r){Object.defineProperty(a,r,Object.getOwnPropertyDescriptor(e,r))})}return a}var te=o.memo(o.forwardRef(function(a,t){var e=x(),r=o.useContext(N),n=y.getProps(a,r),i=n.disabled||n.loading,f=j(j({props:n},n.__parentMetadata),{},{context:{disabled:i}}),d=y.setMetaData(f),c=d.ptm,u=d.cx,P=d.isUnstyled;_(y.css.styles,P,{name:"button",styled:!0});var b=o.useRef(t);if(o.useEffect(function(){O.combinedRefs(b,t)},[b,t]),n.visible===!1)return null;var D=function(){var p=s("p-button-icon p-c",l({},"p-button-icon-".concat(n.iconPos),n.label)),K=e({className:u("icon")},c("icon"));p=s(p,{"p-button-loading-icon":n.loading});var F=e({className:u("loadingIcon",{className:p})},c("loadingIcon")),Y=n.loading?n.loadingIcon||o.createElement(X,g({},F,{spin:!0})):n.icon;return q.getJSXIcon(Y,j({},K),{props:n})},I=function(){var p=e({className:u("label")},c("label"));return n.label?o.createElement("span",p,n.label):!n.children&&!n.label&&o.createElement("span",g({},p,{dangerouslySetInnerHTML:{__html:"&nbsp;"}}))},M=function(){if(n.badge){var p=e({className:s(n.badgeClassName),value:n.badge,unstyled:n.unstyled,__parentMetadata:{parent:f}},c("badge"));return o.createElement(B,p,n.badge)}return null},z=!i||n.tooltipOptions&&n.tooltipOptions.showOnDisabled,R=O.isNotEmpty(n.tooltip)&&z,T={large:"lg",small:"sm"},C=T[n.size],k=D(),U=I(),$=M(),L=n.label?n.label+(n.badge?" "+n.badge:""):n["aria-label"],H=e({ref:b,"aria-label":L,"data-pc-autofocus":n.autoFocus,className:s(n.className,u("root",{size:C,disabled:i})),disabled:i},y.getOtherProps(n),c("root"));return o.createElement(o.Fragment,null,o.createElement("button",H,k,U,n.children,$,o.createElement(A,null)),R&&o.createElement(J,g({target:b,content:n.tooltip,pt:c("tooltip")},n.tooltipOptions)))}));te.displayName="Button";export{te as B};
