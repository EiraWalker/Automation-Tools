import json
import tempfile
import unittest
from unittest.mock import patch
from bundlefoundry import BundleFoundry, Response, RetryLater
from test_automation import COOKIE, PROPS, URL, message, page_response
from vault import Vault

PURCHASE={"id":123,"bundle_id":30,"tier":0,"amount":"0.00","license":"personal"}


class PurchaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.vault=Vault(self.temp.name)
        self.vault.save({"account":"owner@example.com","bundle_cookies":[COOKIE]})
        self.site=BundleFoundry(self.vault)
        self.site.current_message_id="abc123"

    def purchases(self, records):
        return page_response({"auth":PROPS["auth"],"purchases":records})

    def test_existing_free_purchase_with_empty_detail_license_never_posts(self):
        with patch.object(self.site,"request",side_effect=[page_response(PROPS),self.purchases([PURCHASE])]) as request:
            self.assertEqual(self.site.claim(URL),"already_owned")
            self.assertTrue(all(c.kwargs.get("payload") is None for c in request.call_args_list))

    def test_new_free_purchase_is_confirmed_by_my_bundles_when_detail_license_stays_empty(self):
        responses=[page_response(PROPS),self.purchases([]),Response(200,{},b'{"skipped":[]}'),page_response(PROPS),self.purchases([PURCHASE])]
        with patch.object(self.site,"request",side_effect=responses):
            self.assertEqual(self.site.claim(URL),"claimed")
        self.assertEqual(self.site.claim_receipt["purchase_id"],123)
        self.assertEqual(self.site.claim_receipt["owned_license_types"],["personal"])

    def test_uncertain_post_response_is_journaled_and_recovered_without_another_post(self):
        responses=[page_response(PROPS),self.purchases([]),Response(200,{},b'{}'),page_response(PROPS),self.purchases([])]
        with patch.object(self.site,"request",side_effect=responses):
            with self.assertRaises(RetryLater): self.site.claim(URL)
        restarted=BundleFoundry(self.vault)
        restarted.current_message_id="abc123"
        with patch.object(restarted,"request",side_effect=[page_response(PROPS),self.purchases([PURCHASE])]) as request:
            self.assertEqual(restarted.claim(URL),"claimed")
            self.assertTrue(all(c.kwargs.get("payload") is None for c in request.call_args_list))
        # Another notification must never relabel that old event as a new claim.
        restarted.current_message_id="def456"
        with patch.object(restarted,"request",side_effect=[page_response(PROPS),self.purchases([PURCHASE])]):
            self.assertEqual(restarted.claim(URL),"already_owned")

    def test_purchase_for_another_bundle_does_not_verify_claim(self):
        other={**PURCHASE,"bundle_id":99}
        responses=[page_response(PROPS),self.purchases([]),Response(200,{},b'{}'),page_response(PROPS),self.purchases([other])]
        with patch.object(self.site,"request",side_effect=responses):
            with self.assertRaises(RetryLater): self.site.claim(URL)
