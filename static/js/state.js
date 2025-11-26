// state.js

// global state
const state = {
  bmeMap: {},
  deviceHierarchy: {},
  sapMap: {},
  pacsDataDetails: [],
  allUniqueDates: [],
  todayStr: null,

  currentBmeName: null,
  currentBrandModel: null,
  currentAeTitle: null,
  currentMonthFilter: null,
  currentServiceFilter: null,

  chartMonthly: null,
  chartCumulative: null,
  chartServiceDetails: null,

  sortedServiceSummary: [],
  serviceDetailsPage: 0,
  servicePageSize: 5
};

// shorthand DOM helper
const $ = id => document.getElementById(id);

// utilities
const formatShortNumber = num => {
  if (!num) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toLocaleString();
};

const buildSpinnerHtml = message => `
  <div class="loading-container">
    <div class="spinner"></div>
    <p class="text-lg text-gray-600 mt-4">${message}</p>
  </div>
`;

const buildPlaceholderHtml = message => `
  <div class="loading-container">
    <div class="text-xl text-gray-500">${message}</div>
  </div>
`;

const buildErrorHtml = error => `
  <div class="loading-container" style="height:100%;">
    <div class="text-xl text-red-600 font-bold">${TEXTS.genericErrorTitle}</div>
    <p class="text-gray-700 mt-2 p-4">${String(error)}</p>
  </div>
`;
