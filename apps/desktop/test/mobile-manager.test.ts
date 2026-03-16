import { describe, it, expect, vi, beforeEach } from "vitest";
import { MobileManager } from "../src/mobile/mobile-manager.js";

describe("MobileManager", () => {
    let mockStorage: any;
    let manager: MobileManager;

    beforeEach(() => {
        mockStorage = {
            mobilePairings: {
                getActivePairing: vi.fn(),
                getAllPairings: vi.fn().mockReturnValue([]),
                clearPairing: vi.fn(),
                removePairingById: vi.fn(),
            },
        };

        manager = new MobileManager(mockStorage, "http://mock-cp");
    });

    it("should generate and cache a desktop device ID", () => {
        const id1 = manager.getDesktopDeviceId();
        const id2 = manager.getDesktopDeviceId();

        expect(id1).toBeDefined();
        expect(typeof id1).toBe("string");
        expect(id1).toBe(id2); // Should return the cached instance
    });

    it("should proxy active pairing to storage repo", () => {
        const mockPairing = { id: "p1" };
        mockStorage.mobilePairings.getActivePairing.mockReturnValue(mockPairing);

        expect(manager.getActivePairing()).toBe(mockPairing);
        expect(mockStorage.mobilePairings.getActivePairing).toHaveBeenCalled();
    });

    it("should proxy getAllPairings to storage repo", () => {
        const pairings = [{ id: "p1" }, { id: "p2" }];
        mockStorage.mobilePairings.getAllPairings.mockReturnValue(pairings);

        expect(manager.getAllPairings()).toBe(pairings);
        expect(mockStorage.mobilePairings.getAllPairings).toHaveBeenCalled();
    });

    it("should clear pairing and cached code on disconnect all", () => {
        manager.clearActiveCode();
        expect(manager.getActiveCode()).toBeNull();

        manager.disconnectPairing();
        expect(mockStorage.mobilePairings.clearPairing).toHaveBeenCalled();
        expect(manager.getActiveCode()).toBeNull();
    });

    it("should disconnect a specific pairing by ID", () => {
        manager.disconnectPairing("p1");
        expect(mockStorage.mobilePairings.removePairingById).toHaveBeenCalledWith("p1");
    });

    it("should return null for activeCode when none is set", () => {
        expect(manager.getActiveCode()).toBeNull();
    });
});
