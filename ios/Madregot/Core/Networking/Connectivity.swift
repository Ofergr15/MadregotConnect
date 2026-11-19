import Foundation

/// Why a request never got an answer — so the screen can say the true thing.
///
/// "No internet" was shown for every failure, including a phone that is online but pointed at
/// a server that is not there (a dev build on a device, or the club's server being down). That
/// sends people to check their Wi-Fi for a problem their Wi-Fi cannot fix.
enum Connectivity {
    /// True only when the device itself has no usable network.
    static func isOffline(_ error: Error) -> Bool {
        guard let url = error as? URLError else { return false }
        switch url.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
            return true
        default:
            return false
        }
    }

    static let offlineMessage = "אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב."
    static let serverUnavailableMessage = "השרת של המועדון לא זמין כרגע. נסו שוב בעוד כמה דקות."
}
