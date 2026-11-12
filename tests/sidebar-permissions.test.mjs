import assert from "node:assert/strict";
import test from "node:test";
import { enforceOwnerOnlyOverview, getMemberPermissions, getTeamPermissions } from "../lib/access-permissions.ts";
import { canOpenPage } from "../lib/sidebar-access.ts";

test("Overview is available to the workspace owner only, including when a staff role is Admin", () => {
  const owner = getMemberPermissions({ id: "owner", role: "Owner" }, "owner");
  const admin = getMemberPermissions({ id: "admin", role: "Admin", permissions: { overview: true } }, "owner");
  const staff = getMemberPermissions({ id: "staff", role: "Staff", permissions: { overview: true } }, "owner");

  assert.equal(canOpenPage("Overview", owner, true), true);
  assert.equal(canOpenPage("Overview", admin, true), false);
  assert.equal(canOpenPage("Overview", staff, false), false);
  assert.equal(getTeamPermissions("Admin").overview, false);
});

test("workspace saves strip a forged Overview grant from every non-owner profile", () => {
  const trustedOwner = { id: "owner", email: "owner@example.com", permissions: { overview: true } };
  const staff = enforceOwnerOnlyOverview([
    { id: "owner", email: "attacker@example.com", permissions: { overview: true } },
    { id: "admin", permissions: { overview: true, clients: true } },
    { id: "staff", permissions: { overview: true, tasks: true } },
  ], "owner", trustedOwner);

  assert.equal(staff[0].email, "owner@example.com");
  assert.equal(staff[0].permissions?.overview, true);
  assert.equal(staff[1].permissions?.overview, false);
  assert.equal(staff[1].permissions?.clients, true);
  assert.equal(staff[2].permissions?.overview, false);
  assert.equal(staff[2].permissions?.tasks, true);
});

test("a teammate cannot impersonate the owner by reusing the owner's profile ID", () => {
  const teammate = { id: "owner", email: "admin@example.com", role: "Admin", permissions: { overview: true } };
  assert.equal(getMemberPermissions(teammate).overview, false);
  const staff = enforceOwnerOnlyOverview([teammate], "owner", { id: "owner", email: "owner@example.com" });
  assert.equal(staff.length, 1);
  assert.equal(staff[0].email, "owner@example.com");
});

test("unknown page names fail closed while valid delegated pages follow permissions", () => {
  const permissions = getMemberPermissions({ id: "staff", role: "Staff", permissions: { tasks: true, reports: false } }, "owner");
  assert.equal(canOpenPage("Tasks", permissions, false), true);
  assert.equal(canOpenPage("Report Studio", permissions, false), false);
  assert.equal(canOpenPage("Hidden admin page", permissions, true), false);
});
