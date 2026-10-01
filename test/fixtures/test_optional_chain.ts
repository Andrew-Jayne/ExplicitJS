// Fixture: the `optional_chain` check — `?.` property/element access and calls,
// flagged once per chain at its top. Parsed, never executed.

report(user?.name); // expect: optional_chain
report(user.name);
report(config?.server?.port); // expect: optional_chain
report(records?.[0]); // expect: optional_chain
maybeCallback?.(); // expect: optional_chain
report(session.user?.profile.avatar); // expect: optional_chain
