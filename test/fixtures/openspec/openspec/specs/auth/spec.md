# Capability: Auth

The system SHALL authenticate users via email and password.
The system SHALL support password reset.

#### Scenario: successful login
Given a registered user, when they submit valid credentials, then a session is created.

#### Scenario: failed login
Given a registered user, when they submit an invalid password, then login is rejected.
