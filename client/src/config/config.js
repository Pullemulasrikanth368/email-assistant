// Standalone Executive Email Assistant — points to local backend by default.
// Override VITE_API_URL in .env for other environments.
export const url = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '/')
  : 'http://localhost:8676/';

const config = {

  apiUrl: `${url}api/`,
  dmsAiDemoApiUrl: `${url}api/`,
  meetingApiUrl: `${url}api/`,
  socketUrl: url,
  imgUrl: `${url}images/`,
  serverErrMessage: 'Could Not reach server',

  //regex
  borderValidation: false,
  messages: true,

  entityType: 'employee',
  appName: 'AI AGENTS',
  defaultScreen: "/contracts",
  displayProjectName: false,
  displayRecaptcha: false,
  displayGoogleLogin: false,
  loginName: 'Employee',
  selectedLoginScreenName: "1",
  isScreenHeaderBold: true,
  emailRegex: /^(?=.{1,50}$)[_a-z0-9-]+(\.[_a-z0-9-]+)*@[a-z0-9-]+(\.[a-z0-9-]+)*(\.[a-z]{2,4})$/,
  passwordRegex: /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,32}$/,
  aadharcardNumberRegex: /^([0-9]){12}$/,
  pancardNumberRegex: /^([a-zA-Z]){5}([0-9]){4}([a-zA-Z]){1}?$/,
  phoneNumberRegex: /^[0-9]{3}-[0-9]{3}-[0-9]{4}$/,
  userNameRegex: /^[a-zA-Z\s]{1,30}$/,
  lastNameRegex: /^[a-zA-Z\s]{1,30}$/,
  subjectRegex: /^[a-zA-Z\s]{1,50}$/,
  companyRegex: /^([A-Za-z0-9\s@.,]){1,30}$/,
  roomIdRegex: /^([0-9]){4,10}$/,
  // server response codes
  updateResCode: 205,
  deleteResCode: 206,

  datePlaceholder: '--/--/----',
  dateFormat: 'MM/DD/YYYY',
  dateTabularFormat: 'MMM DD YYYY',
  dateDisplayModalFormat: 'DD MMM YYYY',
  dateDBFormat: 'MM-DD-YYYY',
  dateDayMonthFormat: 'DD-MM-YYYY',
  dateYearMonthFormat: 'YYYY-MM-DD',
  dayYearDateFormat: 'YYYY-MM-DD',
  basicDateFromat: 'MM/DD/YYYY HH:mm A',
  descDateFromat: 'MMM DD YYYY HH:mm A',

  timeFormat: 'HH:mm',
  syncTimeFormat: 'hh:mm A, MM-DD-YYYY',
  lastModifiedDateFormat: 'MM/DD/YYYY HH:mm',
  dateTimeFormat: 'MM-DD-YYYY hh:mm',
  dateTimeFormat2: 'MM-DD-YYYY hh:mm A',
  fullDateFormat: 'YYYY-MM-DD HH:mm:ss',
  fullDateTimeFormat: 'YYYY-MM-DD[T]HH:mm:ss.SSZ',
  dbDateFormat: 'YYYY-MM-DD[T]HH:mm:ss.SSZ',
  dbOnlyDateFormat: 'YYYY-MM-DD[T]00:00:00Z',
  ESTTimezone: "America/New_York",
  formFieldStatusTypes: [
    { label: "Active", value: "Active" },
    { label: "Pending", value: "Pending" },
    { label: "Inactive", value: "Inactive" }
  ],
  noView: 'noView',
  edit: 'edit',
  view: 'view',
  // templateColor: '#0e4768',
  whiteColor: '#ffffff',
  sourceKey: "qVtYv2x5A7CaFcHeMh",
  paginationPosition: 'top',
  displaySettings: true,
  selectionLimit: 30,
  filterLimit: 20,
  MAX_SORT_FIELDS: 3,
  BUTTON_STYLE: 'regular',
  BUTTON_ROUNDED: 'regular',
  DEFAULT_FONT_SIZE: '14px',
  FONT_STYLE: 'Poppins, sans-serif',
  imageFormats: ['.png', '.apng', '.avif', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.tiff', '.tif', '.webp', '.jfif', '.pjpeg', '.pjp', '.ico', '.heic', '.heif', '.raw', '.arw', '.cr2', '.nrw', '.orf', '.raf', '.dng'],
  videoFormats: ["mp4", "mov", "avi", "mkv", "wmv", "flv", "webm", "mpeg", "mpg", "3gp", "m4v", "ogv", "mts", "m2ts", "ts", "vob", "rm", "rmvb", "divx"],
  defaultConfigColors: {
    loginBgColor: '#3c6177',
    templateColor: '#3c6177',
    sidebarBgColor: '#3c6177',
    sidebarTextColor: '#ffffff',
    sidebarIconColor: '#ffffff',
    sidebarHoverColor: '#2f4a5c',
    navbarBgColor: '#ffffff',
    navbarTextColor: '#3c6177',
    buttonBgColor: '#3c6177',
    buttonTextColor: '#ffffff',
    tableHeaderBgColor: '#3c6177',
    tableHeaderTextColor: '#ffffff',
    tableDataTextColor: '#495057',
  },
  defaultColorConfigs: "defaultAdminColorConfigs",
  customColorConfigs: "customAdminColorConfigs",
  defaultRole: "Admin",
  booleanOptions: [
    { label: "Yes", value: true, color: "success" },
    { label: "No", value: false, color: "danger" }
  ],
  credentials: import.meta.env.VITE_CREDENTIALS === 'true' ? true : false,
  VOICE: {
    ENABLED: true,
    LANG: 'en-US',
    RATE: 1,
    PITCH: 1,
    SILENCE_DELAY: 2000
  },
  aiProvider: "openai",// "openai/ollama",
  // Standalone: all screens route to the single local API.
  dmsAiDemoScreens: [],
  meetingScreens: [],

  //Attendance System
  type: 'openCV',//  'openCV' or 'faceApi.js'

  ocrUploadScreens: [
    "documentType",
  ],

  languageOptions: [
    { label: "English (English)", value: "en-US" },
    { label: "Arabic (العربية - Saudi Arabia)", value: "ar-SA" },
    { label: "Arabic (العربية - UAE)", value: "ar-AE" },
    { label: "Hindi (हिन्दी)", value: "hi-IN" },
    { label: "Malayalam (മലയാളം)", value: "ml-IN" },
    { label: "Telugu (తెలుగు)", value: "te-IN" }
  ],

};
export default config;
