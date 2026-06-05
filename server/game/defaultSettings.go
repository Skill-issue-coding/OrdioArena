package game

// DefaultImpostorSettings returns the settings applied when a lobby first
// selects the Impostor mode. These are used as the baseline before the host
// makes any manual adjustments via UpdateSettingsRequestEvent.
func DefaultImpostorSettings() ImpostorSettings {
	return ImpostorSettings{
		InputDuration:      30,
		DiscussionDuration: 45,
		ImpostorCount:      1,
		VoteDuration:       30,
	}
}

// DefaultAntiMatchSettings returns the settings applied when a lobby first
// selects the AntiMatch mode. These are used as the baseline before the host
// makes any manual adjustments via UpdateSettingsRequestEvent.
func DefaultAntiMatchSettings() AntiMatchSettings {
	return AntiMatchSettings{
		InputDuration: 20,
		Rounds:        3,
	}
}
