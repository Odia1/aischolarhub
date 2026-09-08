/**
 * Browser session-recording telemetry is intentionally disabled in AIH.
 *
 * AIH does not configure a browser RUM provider. Retaining the optional
 * HyperDX recorder would add archive and protobuf parsers to the public
 * client bundle without providing an active AIH service.
 *
 * Server observability, usage accounting, and Langfuse are unaffected.
 */
export default function useRum(): void {}
