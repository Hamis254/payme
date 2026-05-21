import logger from '#config/logger.js';
import { signupSchema, signInSchema } from '#validations/auth.validation.js';
import { formatValidationError } from '#utils/format.js';
import { createUser, authenticateUser } from '#services/auth.service.js';
import { jwttoken } from '#utils/jwt.js';
import { cookies } from '#utils/cookies.js';

export const signup = async (req, res, next) => {
  try {
    const validationResult = signupSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { name, phone_number, password, role } = validationResult.data;

    const user = await createUser({ name, phone_number, password, role });

    const token = jwttoken.sign({
      id: user.id,
      name: user.name,
      role: user.role,
    });

    cookies.set(res, 'token', token);

    logger.info(`User registered successfully: ${name}`);

    res.status(201).json({
      message: 'User registered',
      setupNeeded: true,
      setup_steps: [
        {
          step: 1,
          title: 'Create your business',
          endpoint: 'POST /api/businesses',
          required: true,
        },
        {
          step: 2,
          title: 'Configure M-Pesa payment method',
          endpoint: 'POST /api/payment-config/setup',
          hint: 'GET /api/payment-config/fields?method=paybill to see required fields',
          required: true,
        },
        {
          step: 3,
          title: 'Add your stock',
          endpoint: 'POST /api/stock/products',
          required: false,
        },
      ],
      user: {
        id: user.id,
        name: user.name,
        phone_number: user.phone_number,
        email: user.email,
        role: user.role,
      },
    });
  } catch (e) {
    logger.error('Signup error', e);

    if (e.message === 'User with this name already exists') {
      return res.status(409).json({ error: 'Name already exists' });
    }

    if (e.message === 'User with this phone number already exists') {
      return res.status(409).json({ error: 'Phone number already exists' });
    }

    next(e);
  }
};

export const signIn = async (req, res, next) => {
  try {
    const validationResult = signInSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationError(validationResult.error),
      });
    }

    const { name, password } = validationResult.data;

    const user = await authenticateUser({ name, password });

    const token = jwttoken.sign({
      id: user.id,
      name: user.name,
      role: user.role,
    });

    cookies.set(res, 'token', token);

    logger.info(`User signed in successfully: ${name}`);
    res.status(200).json({
      message: 'User signed in successfully',
      user: {
        id: user.id,
        name: user.name,
        phone_number: user.phone_number,
        email: user.email,
        role: user.role,
      },
    });
  } catch (e) {
    logger.error('Sign in error', e);

    if (e.message === 'User not found' || e.message === 'Invalid password') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    next(e);
  }
};

export const signOut = async (req, res, next) => {
  try {
    cookies.clear(res, 'token');
    logger.info('User signed out successfully');
    res.status(200).json({ message: 'User signed out successfully' });
  } catch (e) {
    logger.error('Sign out error', e);
    next(e);
  }
};
