---
id: threat-model
lang: en
---

# Checklist: threat model (simple STRIDE)

When to use it: when a change touches authentication, sensitive data, external input or infrastructure.

## Assets <!-- section: assets -->

- [ ] The data and capabilities to protect are listed
- [ ] Each asset has an owner and a sensitivity level

## Entry points and boundaries <!-- section: entry-points -->

- [ ] Every input (API, files, queues, administration) is listed
- [ ] The trust boundaries each data flow crosses are marked

## S: spoofing <!-- section: spoofing -->

- [ ] Every actor and service is authenticated
- [ ] Credentials are rotated and can be revoked

## T: tampering <!-- section: tampering -->

- [ ] Input is validated on the server
- [ ] Data in transit and at rest cannot be altered without detection

## R: repudiation <!-- section: repudiation -->

- [ ] Sensitive actions are logged with who and when
- [ ] Whoever acts cannot delete the logs

## I: information disclosure <!-- section: information-disclosure -->

- [ ] Every access checks authorization per resource
- [ ] Errors and logs expose no secrets or personal data

## D: denial of service <!-- section: denial-of-service -->

- [ ] There are limits on size, rate and time
- [ ] The expensive operations an anonymous user can trigger are known

## E: elevation of privilege <!-- section: elevation-of-privilege -->

- [ ] Each component only has the permissions it uses
- [ ] Administration functions are separated and protected

## Mitigations and follow-up <!-- section: mitigations -->

- [ ] Each threat has a mitigation, or an accepted risk with who accepts it
- [ ] Each pending mitigation has an owner and a date
- [ ] Important mitigations have a test

## For a prompt <!-- prompt -->

What `engkit prompt --checklist threat-model` adds to the prompt.

### Limits <!-- limits -->

- Do not call a threat mitigated without pointing to the control in the code or configuration
- Do not run attack tests against environments without authorization

### Verification <!-- verify -->

- Every entry point was reviewed against the 6 STRIDE categories
- Every threat has a mitigation or an accepted risk, and an owner
