export const request: any = {};

request?.headers; // expect: optional_chain
request?.headers?.auth?.token; // expect: optional_chain
request.headers.auth.token;
request?.headers.auth.token; // expect: optional_chain
request?.["headers"]?.auth; // expect: optional_chain
request?.fn?.(); // expect: optional_chain
const direct = request.headers;
