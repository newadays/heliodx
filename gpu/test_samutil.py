import unittest

import numpy as np

from samutil import normalise_box, rle_decode, rle_encode


class RleTest(unittest.TestCase):
    def roundtrip(self, mask):
        h, w = mask.shape
        self.assertTrue(np.array_equal(rle_decode(rle_encode(mask), h, w), mask))

    def test_starts_with_false_run(self):
        m = np.array([[1, 1, 0], [0, 1, 1]], dtype=bool)
        self.assertEqual(rle_encode(m), [0, 2, 2, 2])
        self.roundtrip(m)

    def test_all_false_and_all_true(self):
        self.assertEqual(rle_encode(np.zeros((2, 3), bool)), [6])
        self.assertEqual(rle_encode(np.ones((2, 3), bool)), [0, 6])
        self.roundtrip(np.zeros((4, 5), bool))
        self.roundtrip(np.ones((4, 5), bool))

    def test_random_masks_roundtrip(self):
        rng = np.random.default_rng(7)
        for _ in range(20):
            self.roundtrip(rng.random((37, 53)) > 0.6)

    def test_rejects_wrong_size(self):
        with self.assertRaises(ValueError):
            rle_decode([2, 2], 3, 3)


class BoxTest(unittest.TestCase):
    def test_normalises_and_clamps(self):
        self.assertEqual(normalise_box([10, 20, 110, 220], 200, 400), [0.05, 0.05, 0.55, 0.55])
        self.assertEqual(normalise_box([-5, 0, 500, 400], 200, 400), [0.0, 0.0, 1.0, 1.0])


if __name__ == "__main__":
    unittest.main()
