import { toast } from 'react-toastify';
import './toastSpinner.css';
import 'react-toastify/dist/ReactToastify.css';
import 'react-toastify/dist/ReactToastify.min.css';

const toastConfig = {
    position: "top-right",
    autoClose: 5000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
    theme: "light",
};

const showToasterMessage = async (message, type, position = 'top-right') => {

    if (type === 'success') {
        toast.success(message, {
            ...toastConfig,
            autoClose: 4000,
            theme: "colored",
            position,
        });

    } else if (type === 'error') {
        toast.error(message, {
            ...toastConfig,
            autoClose: 2000,
            theme: "colored",
            position,
        });

    } else if (type === 'warning') {
        toast.warn(message, {
            ...toastConfig,
            autoClose: 2000,
            theme: "colored",
            position,
        });

    } else if (type === 'loading') {
        return toast.info(
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="loader">
                    <div className="bar1"></div>
                    <div className="bar2"></div>
                    <div className="bar3"></div>
                    <div className="bar4"></div>
                    <div className="bar5"></div>
                    <div className="bar6"></div>
                    <div className="bar7"></div>
                    <div className="bar8"></div>
                    <div className="bar9"></div>
                    <div className="bar10"></div>
                    <div className="bar11"></div>
                    <div className="bar12"></div>
                </div>
                <span>{message || 'Please wait while we process...'}</span>
            </div>,
            {
                ...toastConfig,
                autoClose: false,
                closeOnClick: false,
                draggable: false,
                theme: "colored",
                position,
                toastId: "loader-toast", // prevents duplicate loaders
            }
        );
    }
};

export default showToasterMessage;
