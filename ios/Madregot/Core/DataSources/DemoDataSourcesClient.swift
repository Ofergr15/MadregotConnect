#if DEBUG || DEMO
import Foundation

/// Made-up connection state for demo mode: one healthy source, one that needs attention,
/// so both looks of the screen can be reviewed. Debug builds only.
struct DemoDataSourcesClient: DataSourcesClient {
    func status(athleteId: String, accessToken: String) async throws(DataSourcesError) -> DataSourcesStatus {
        try? await Task.sleep(for: .milliseconds(400))
        return DataSourcesStatus(
            garmin: .ok,
            strava: .failed,
            garminLastSync: Date.now.addingTimeInterval(-2 * 3600),
            stravaLastSync: Date.now.addingTimeInterval(-9 * 86_400),
            primarySource: "garmin"
        )
    }
}
#endif
