import config from './config';
import showToasterMessage from '../containers/UI/ToasterMessage/toasterMessage';
// import Cookies from 'js-cookie';
let headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
};

// To get logged in user token
const getLoggedInuserToken = () => {
    let userData = localStorage.getItem('loginCredentials');
    userData = JSON.parse(userData);
    if (userData) {
        headers.Authorization = `Bearer ${userData.accessToken}`;
        headers.logggedInUserData = {
            email: userData.email,
            password: userData.password,
        }
        return headers;
    } else {
        return headers;
    }
}

const resolveBaseUrl = (route, urlend) => {
    if (urlend === 'auth/login' || urlend === 'users/getProfile' || urlend === "auth/logout") {
        return config.dmsAiDemoApiUrl
    }
    if (!route) return config.apiUrl;

    if (config.meetingScreens.includes(route)) {
        return config.meetingApiUrl;
    } else if (config.dmsAiDemoScreens.includes(route)) {
        return config.dmsAiDemoApiUrl;
    } else if (config.ocrUploadScreens.includes(route)) {
        return config.dmsAiDemoApiUrl;
    }
    return config.apiUrl;
};

const fetchMethodRequest = (method, url, body = null, type = "", mul = false, route) => {
    if (url === 'auth/login') {
        return sendRequestToServer(method, url, body, headers);
    } else {
        let headers = getLoggedInuserToken();
        // upload method conditions, headers
        if (type && type == 'upload') {
            let formData = new FormData();
            if (body && !mul) {
                formData.append('file', body);
            }
            if (body && mul) {
                body.forEach(ele => {
                    formData.append('file', ele);
                })
            }
            else {
                if (body && body.files) {
                    for (let file of body.files) {
                        formData.append('file', file);
                    }
                }
            }
            if (headers.logggedInUserData) {
                delete headers.logggedInUserData;
            }
            body = {
                isUploadingImage: true,
                imageInfo: formData,
            }
        }
        return sendRequestToServer(method, url, body, headers, route)
            .then(response => {
                if (response) {
                    if (response.errorCode && response.errorCode === 9001) { // token expiry
                        return response;
                    }
                    else if (response.errorCode && response.erroCode === 401) {
                        return response;
                    }
                    else {
                        return response;
                    }
                }
            })
            .catch((err) => {
            });
    }
}

// generate guid and update headers
const sendLoginRequestForToken = (method, url, body) => {
    let headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json'
    };

    return sendRequestToServer(method, url, body, headers).then(response => {
        if (response) {
            if (response.respCode && response.respCode === 200) {
                let tokenInfo = {
                    accessToken: response.accessToken,
                    refreshToken: response.refreshToken,
                    tokenExpires: response.tokenExpires
                }
                let userData = { ...body, ...tokenInfo };
                // save user credentials in storage
                headers.Authorization = `Bearer ${userData.accessToken}`;

                // To set logged in doctor details
                let userDetails = response.details;
                if (userDetails && userDetails._id) {
                    userData._id = userDetails._id;
                    localStorage.setItem("loginCredentials", JSON.stringify(userData));
                }

                return headers;
            } else if (response.errorCode) {
                // move user to login screen
                return 9002; // login request failed
            }
        } else {
            return null;
        }
    });
}

const sendRequestToServer = (method, url, body, headers, route) => {
    let reqHeaders = { ...headers };

    if (reqHeaders && reqHeaders.logggedInUserData) {
        delete reqHeaders.logggedInUserData;
    }
    let isImageReqSent = false;
    let request;

    if (body && body.isUploadingImage) { // only for image upload
        const baseUrl = resolveBaseUrl(route, url);
        isImageReqSent = true;
        request = fetch(`${baseUrl}${url}`, {
            method: method,
            headers: {
                'Authorization': `${reqHeaders.Authorization}`,

            },
            body: body.imageInfo,
            // credentials: config.credentials ? "include" : undefined,
            // credentials: "include"
        })

    }

    if (!isImageReqSent) { // send request for call except image upload 
        const baseUrl = resolveBaseUrl(route, url);

        if (method === 'GET' || method === 'DELETE') {
            request = fetch(`${baseUrl}${url}`, {
                method: method, headers: reqHeaders,
                // credentials: "include" 
                // credentials: config.credentials ? "include" : undefined,

            },)
        } else if (method === 'POST' || method === 'PUT') {

            const isFormData = body instanceof FormData;

            if (isFormData) {
                // Remove JSON content type
                delete reqHeaders['Content-Type'];

                request = fetch(`${baseUrl}${url}`, {
                    method: method,
                    headers: reqHeaders,
                    body: body,
                });
            } else {
                request = fetch(`${baseUrl}${url}`, {
                    method: method,
                    headers: reqHeaders,
                    body: JSON.stringify(body),
                });
            }
        }

    }

    return request.then(res => res.json())
        .then(responseJson => {
            const isSettingsUrl = url === 'settings'
            // console.log("RESP", responseJson);
            if (responseJson && responseJson?.errorCode === 401) {
                // redirectToLogin();
                return;
            }
            return responseJson;
        }).catch(err => {
            showToasterMessage(config.serverErrMessage, 'error');
            return 'serverError';
        });
}

function redirectToLogin() {
    // Prevent redirect loop
    console.log("WINdOWS", window.location.pathname);
    window.location.href = "/";
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    console.log("COOKIE VALUE", value);
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

export default fetchMethodRequest;
