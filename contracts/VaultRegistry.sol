// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title VaultRegistry - registry for IPFS CIDs with per-vault access control
/// @notice Minimal, audit-friendly contract for hackathon MVP
contract VaultRegistry {
    struct Vault {
        string cid;
        address owner;
        uint256 createdAt;
    }

    uint256 private _nextId = 1;
    mapping(uint256 => Vault) private _vaults;
    // access controls: vaultId => (address => bool)
    mapping(uint256 => mapping(address => bool)) private _access;
    // owner => list of vault ids
    mapping(address => uint256[]) private _ownerVaults;

    // Events
    event Stored(uint256 indexed vaultId, string cid, address indexed owner);
    event AccessGranted(uint256 indexed vaultId, address indexed grantee, address indexed granter);
    event AccessRevoked(uint256 indexed vaultId, address indexed grantee, address indexed revoker);

    // Errors
    error NotOwner();
    error VaultNotFound();
    error AlreadyHasAccess();
    error NoAccessToRevoke();
    error InvalidAddress();
    error EmptyCID();

    /// @notice Store a new IPFS CID in registry. Caller becomes owner and has access.
    /// @param cid The IPFS CID (encrypted payload should be stored off-chain)
    /// @return vaultId The id assigned to the stored CID
    function store(string calldata cid) external returns (uint256 vaultId) {
        if (bytes(cid).length == 0) revert EmptyCID();

        vaultId = _nextId++;
        _vaults[vaultId] = Vault({
            cid: cid,
            owner: msg.sender,
            createdAt: block.timestamp
        });

        _access[vaultId][msg.sender] = true;
        _ownerVaults[msg.sender].push(vaultId);

        emit Stored(vaultId, cid, msg.sender);
    }

    /// @notice Grant access to `grantee` for vault `vaultId`. Only owner can call.
    function grantAccess(uint256 vaultId, address grantee) external {
        Vault storage v = _vaults[vaultId];
        if (v.owner == address(0)) revert VaultNotFound();
        if (v.owner != msg.sender) revert NotOwner();
        if (grantee == address(0)) revert InvalidAddress();
        if (_access[vaultId][grantee]) revert AlreadyHasAccess();

        _access[vaultId][grantee] = true;
        emit AccessGranted(vaultId, grantee, msg.sender);
    }

    /// @notice Revoke access from `grantee` for vault `vaultId`. Only owner can call.
    function revokeAccess(uint256 vaultId, address grantee) external {
        Vault storage v = _vaults[vaultId];
        if (v.owner == address(0)) revert VaultNotFound();
        if (v.owner != msg.sender) revert NotOwner();
        if (grantee == address(0)) revert InvalidAddress();
        if (!_access[vaultId][grantee]) revert NoAccessToRevoke();
        if (grantee == v.owner) revert NoAccessToRevoke(); // owner access cannot be revoked

        _access[vaultId][grantee] = false;
        emit AccessRevoked(vaultId, grantee, msg.sender);
    }

    /// @notice Check whether `who` has access to vault `vaultId`.
    function hasAccess(uint256 vaultId, address who) public view returns (bool) {
        Vault storage v = _vaults[vaultId];
        if (v.owner == address(0)) revert VaultNotFound();
        return _access[vaultId][who];
    }

    /// @notice Returns owner of vault id
    function ownerOf(uint256 vaultId) public view returns (address) {
        Vault storage v = _vaults[vaultId];
        if (v.owner == address(0)) revert VaultNotFound();
        return v.owner;
    }

    /// @notice Get CID for vaultId if caller has access (or the caller address passed has access)
    /// @dev For privacy, only returns CID to callers that have access.
    function getCid(uint256 vaultId) external view returns (string memory) {
        Vault storage v = _vaults[vaultId];
        if (v.owner == address(0)) revert VaultNotFound();
        if (!_access[vaultId][msg.sender]) revert NoAccessToRevoke();
        return v.cid;
    }

    /// @notice Get metadata about a vault (cid omitted) - owner and createdAt.
    function getVaultInfo(uint256 vaultId) external view returns (address owner, uint256 createdAt) {
        Vault storage v = _vaults[vaultId];
        if (v.owner == address(0)) revert VaultNotFound();
        return (v.owner, v.createdAt);
    }

    /// @notice List vault ids owned by `ownerAddr`
    function vaultsOfOwner(address ownerAddr) external view returns (uint256[] memory) {
        return _ownerVaults[ownerAddr];
    }
}
